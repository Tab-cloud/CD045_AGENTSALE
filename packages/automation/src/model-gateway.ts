import {z} from 'zod';
import {requestBytes} from './network';
import {assertProvider} from './providers';
import {FlowError,type SecretSettings} from './types';

const message=z.object({role:z.enum(['system','user','assistant']),content:z.string().max(120_000)}).strict();
export const textGenerationSchema=z.object({
  action:z.literal('text.generate'),
  id:z.string().uuid(),
  messages:z.array(message).min(1).max(40),
  jsonSchema:z.record(z.string(),z.unknown()).optional(),
}).strict().superRefine((request,ctx)=>{
  if(JSON.stringify(request.messages).length>160_000)ctx.addIssue({code:'custom',message:'模型消息超出上限'});
  if(request.jsonSchema&&JSON.stringify(request.jsonSchema).length>16_000)ctx.addIssue({code:'custom',message:'输出结构超出上限'});
});
export type TextGeneration=z.infer<typeof textGenerationSchema>;
export const imageGenerationSchema=z.object({action:z.enum(['image.generate','image.edit']),id:z.string().uuid(),prompt:z.string().trim().min(1).max(2500),reference:z.string().max(5_333_336).optional()}).strict().superRefine((request,ctx)=>{
  if(request.action==='image.edit'&&!request.reference)ctx.addIssue({code:'custom',message:'图片编辑需要参考图'});
  if(request.action==='image.generate'&&request.reference)ctx.addIssue({code:'custom',message:'图片生成不接受参考图'});
});
export const videoGenerationSchema=z.object({action:z.literal('video.generate'),id:z.string().uuid(),prompt:z.string().trim().min(1).max(2500)}).strict();
export const videoPollSchema=z.object({action:z.literal('video.poll'),id:z.string().uuid()}).strict();
export const audioSpeechSchema=z.object({action:z.literal('audio.speech'),id:z.string().uuid(),text:z.string().trim().min(1).max(600)}).strict();

export async function generateText(config:SecretSettings,request:TextGeneration,transport:typeof requestBytes=requestBytes){
  assertProvider(config,false);
  const messages=request.messages.map(message=>({...message}));
  const body:Record<string,unknown>={model:config.model,messages};
  if(request.jsonSchema){
    if(config.format==='json_schema')body.response_format={type:'json_schema',json_schema:{name:'desktop_output',strict:true,schema:request.jsonSchema}};
    else if(config.format==='json_object')body.response_format={type:'json_object'};
    else {
      const last=[...messages].reverse().find(message=>message.role==='user');
      if(last)last.content+='\nRequired JSON schema:\n'+JSON.stringify(request.jsonSchema);
    }
  }
  if(config.protocol==='minimax'){
    body.reasoning_split=true;
    if(config.model==='MiniMax-M3')body.thinking={type:'disabled'};
  }
  const response=await transport(config.baseUrl.replace(/\/$/,'')+'/chat/completions',{
    method:'POST',headers:{'Content-Type':'application/json',...(config.apiKey?{Authorization:'Bearer '+config.apiKey}:{})},
    body:JSON.stringify(body),local:config.localModel,trustedMiniMax:config.protocol==='minimax',timeout:120000,maxBytes:8_000_000
  });
  if(response.status!==200)throw new FlowError('MODEL_HTTP',`模型服务返回 HTTP ${response.status}，请检查模型、权限及额度`,response.status===429||response.status>=500);
  let data:unknown;
  try{data=JSON.parse(response.body.toString());}catch{throw new FlowError('MODEL_RESPONSE','模型服务未返回有效 JSON');}
  const result=data as {choices?:{message?:{content?:unknown;refusal?:unknown};finish_reason?:string}[];model?:unknown;usage?:unknown};
  const choice=result.choices?.[0];
  if(choice?.finish_reason==='length')throw new FlowError('MODEL_TRUNCATED','模型输出达到长度上限');
  if(choice?.message?.refusal)throw new FlowError('MODEL_REFUSAL','模型拒绝该请求');
  if(typeof choice?.message?.content!=='string'||!choice.message.content.trim())throw new FlowError('MODEL_RESPONSE','模型未返回有效文本');
  const text=choice.message.content.replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
  if(!text)throw new FlowError('MODEL_RESPONSE','模型未返回有效文本');
  return {text,model:typeof result.model==='string'?result.model:config.model,usage:result.usage??null};
}

export async function generateSpeech(config:SecretSettings,text:string,transport:typeof requestBytes=requestBytes){
  if(!config.minimaxKey||!config.minimax.enabled)throw new FlowError('AUDIO_UNCONFIGURED','音频模型未配置或未启用');
  const response=await transport(config.minimax.baseUrl+'/t2a_v2',{
    method:'POST',headers:{Authorization:'Bearer '+config.minimaxKey,'Content-Type':'application/json'},
    body:JSON.stringify({model:config.minimax.speechModel,text,stream:false,voice_setting:{voice_id:config.minimax.voiceId,speed:1,vol:1,pitch:0},audio_setting:{sample_rate:32000,bitrate:128000,format:'mp3',channel:1},output_format:'hex'}),
    trustedMiniMax:true,timeout:120000,maxBytes:20_000_000
  });
  if(response.status!==200)throw new FlowError('AUDIO_HTTP',`音频模型返回 HTTP ${response.status}`);
  let data:unknown;
  try{data=JSON.parse(response.body.toString());}catch{throw new FlowError('AUDIO_RESPONSE','音频模型响应格式无效');}
  const result=data as {base_resp?:{status_code?:number};data?:{status?:number;audio?:unknown};extra_info?:{usage_characters?:number;audio_length?:number}};
  const hex=result.data?.audio;
  if(result.base_resp?.status_code!==0||result.data?.status!==2||typeof hex!=='string'||hex.length<8||hex.length>40_000_000||hex.length%2!==0||!/^[\da-f]+$/i.test(hex))throw new FlowError('AUDIO_RESPONSE','音频模型未返回完整音频');
  const bytes=Buffer.from(hex,'hex');
  if(bytes.subarray(0,3).toString()!=='ID3'&&!(bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0))throw new FlowError('AUDIO_RESPONSE','音频模型未返回 MP3 数据');
  return {bytes,mime:'audio/mpeg',model:config.minimax.speechModel,usage:{characters:result.extra_info?.usage_characters??null,durationMs:result.extra_info?.audio_length??null}};
}
