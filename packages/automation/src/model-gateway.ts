import {z} from 'zod';
import {requestBytes} from './network';
import {assertProvider} from './providers';
import {FlowError,providerRejectedBeforeExecution,type SecretSettings} from './types';

const message=z.object({role:z.enum(['system','user','assistant']),content:z.string().max(120_000)}).strict();
export const textGenerationSchema=z.object({
  action:z.literal('text.generate'),
  providerId:z.enum(['standard','minimax']),
  id:z.string().uuid(),
  messages:z.array(message).min(1).max(40),
  jsonSchema:z.record(z.string(),z.unknown()).optional(),
}).strict().superRefine((request,ctx)=>{
  if(JSON.stringify(request.messages).length>160_000)ctx.addIssue({code:'custom',message:'模型消息超出上限'});
  if(request.jsonSchema&&JSON.stringify(request.jsonSchema).length>16_000)ctx.addIssue({code:'custom',message:'输出结构超出上限'});
});
export type TextGeneration=z.infer<typeof textGenerationSchema>;
const mediaParameters=z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),z.union([z.string().max(150),z.number().finite(),z.boolean()])).refine(value=>JSON.stringify(value).length<=2000,'模型参数过长');
export const imageGenerationSchema=z.object({action:z.enum(['image.generate','image.edit']),providerId:z.enum(['standard','minimax']),id:z.string().uuid(),prompt:z.string().trim().min(1).max(2500),reference:z.string().max(5_333_336).optional(),referenceMime:z.enum(['image/png','image/jpeg','image/webp']).optional(),parameters:mediaParameters.optional()}).strict().superRefine((request,ctx)=>{
  if(request.action==='image.edit'&&(!request.reference||!request.referenceMime))ctx.addIssue({code:'custom',message:'图片编辑需要参考图及类型'});
  if(request.action==='image.generate'&&(request.reference||request.referenceMime))ctx.addIssue({code:'custom',message:'图片生成不接受参考图'});
  if(request.action==='image.edit'&&request.providerId!=='standard')ctx.addIssue({code:'custom',message:'聚合连接暂不支持本地参考图编辑'});
});
export const videoGenerationSchema=z.object({action:z.literal('video.generate'),providerId:z.enum(['standard','minimax']),id:z.string().uuid(),prompt:z.string().trim().min(1).max(2500),parameters:mediaParameters.optional()}).strict();
export const videoPollSchema=z.object({action:z.literal('video.poll'),id:z.string().uuid()}).strict();
export const audioSpeechSchema=z.object({action:z.literal('audio.speech'),providerId:z.enum(['standard','minimax']),id:z.string().uuid(),text:z.string().trim().min(1).max(600),voiceId:z.string().min(1).max(100),parameters:mediaParameters.optional()}).strict();

function textStreamDecoder(fallbackModel:string,minimax:boolean,onDelta?:(delta:string)=>void){
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let pending='',text='',model=fallbackModel,usage:unknown=null,done=false,finishReason:string|undefined;
  function eventData(event:string){
    const data=event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!data||done)return;
    if(data==='[DONE]'){done=true;return;}
    let chunk:unknown;
    try{chunk=JSON.parse(data);}catch{throw new FlowError('MODEL_RESPONSE','模型流返回无效事件');}
    if(!chunk||typeof chunk!=='object'||Array.isArray(chunk))throw new FlowError('MODEL_RESPONSE','模型流返回无效事件');
    const value=chunk as {choices?:{delta?:{content?:unknown;refusal?:unknown};finish_reason?:unknown}[];model?:unknown;usage?:unknown;error?:unknown;base_resp?:{status_code?:unknown}};
    if(value.error)throw new FlowError('MODEL_STREAM_ERROR','模型生成过程中返回错误，结果无法确认',true);
    if(minimax&&value.base_resp?.status_code!==undefined&&value.base_resp.status_code!==0){
      const code=value.base_resp.status_code;
      if(typeof code!=='number'||!Number.isInteger(code))throw new FlowError('MODEL_RESPONSE','MiniMax 返回无效的业务状态');
      const reason=code===1004||code===2049?'请检查 API 密钥及模型权限':code===1008?'请检查供应商余额':code===1002||code===2056?'请检查供应商额度或调用频率':'请检查模型配置或供应商状态';
      const rejectedBeforeExecution=[1002,1004,1008,1041,2013,2049,2056].includes(code)&&!text;
      const uncertain=[1000,1001,1024,1033].includes(code);
      throw new FlowError(rejectedBeforeExecution?'PROVIDER_UNAVAILABLE':'MODEL_PROVIDER_ERROR','MiniMax 返回错误码 '+code+'：'+reason,uncertain);
    }
    if(typeof value.model==='string')model=value.model;
    if(value.usage!=null)usage=value.usage;
    const choice=value.choices?.[0];
    if(choice?.delta?.refusal||choice?.finish_reason==='content_filter')throw new FlowError('MODEL_REFUSAL','模型拒绝该请求');
    if(choice?.finish_reason==='length')throw new FlowError('MODEL_TRUNCATED','模型输出达到长度上限');
    if(typeof choice?.finish_reason==='string')finishReason=choice.finish_reason;
    if(typeof choice?.delta?.content==='string'){
      text+=choice.delta.content;
      if(choice.delta.content)onDelta?.(choice.delta.content);
    }
    else if(choice?.delta?.content!=null)throw new FlowError('MODEL_RESPONSE','模型流返回不支持的文本格式');
  }
  return {
    feed(bytes:Buffer,end=false){
      try{pending+=decoder.decode(bytes,{stream:!end});}catch{throw new FlowError('MODEL_RESPONSE','模型流包含无效文本编码');}
      let boundary;
      while((boundary=/\r?\n\r?\n/.exec(pending))){
        const event=pending.slice(0,boundary.index);
        pending=pending.slice(boundary.index+boundary[0].length);
        eventData(event);
      }
      if(end&&pending.trim())eventData(pending);
    },
    result(){
      // Some OpenAI-compatible providers close a completed SSE stream after
      // finish_reason=stop without sending the optional [DONE] sentinel.
      if(!done&&finishReason!=='stop')throw new FlowError('MODEL_STREAM_INCOMPLETE','模型流中断，结果无法确认',true);
      if(finishReason!=='stop'||!text.trim())throw new FlowError('MODEL_RESPONSE','模型未返回完整有效文本');
      text=text.replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
      if(!text)throw new FlowError('MODEL_RESPONSE','模型未返回有效文本');
      return {text,model,usage};
    }
  };
}

export async function generateText(config:SecretSettings,request:TextGeneration,transport:typeof requestBytes=requestBytes,onDelta?:(delta:string)=>void){
  if(request.providerId==='minimax'){
    if(!config.minimax.aggregate||!config.aggregateKey)throw new FlowError('PROVIDER_UNAVAILABLE','MiniMax 聚合文本连接未启用');
    config={...config,baseUrl:config.minimax.baseUrl,model:config.minimax.textModel,localModel:false,format:'prompt_json',protocol:'minimax',apiKey:config.aggregateKey};
  }
  try{assertProvider(config,false);}catch(error){if(FlowError.is(error)&&error.code==='MODEL_UNCONFIGURED')throw new FlowError('PROVIDER_UNAVAILABLE','所选文本连接未配置或未启用');throw error;}
  const messages=request.messages.map(message=>({...message}));
  const body:Record<string,unknown>={model:config.model,messages,stream:true};
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
  const stream=textStreamDecoder(config.model,config.protocol==='minimax',onDelta);
  let received=false;
  const response=await transport(config.baseUrl.replace(/\/$/,'')+'/chat/completions',{
    method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream',...(config.apiKey?{Authorization:'Bearer '+config.apiKey}:{})},
    body:JSON.stringify(body),local:config.localModel,trustedMiniMax:config.protocol==='minimax',idleTimeout:600_000,maxDuration:1_800_000,maxBytes:8_000_000,collectBody:false,
    onChunk:(chunk,status,headers)=>{
      if(status!==200||!/^text\/event-stream(?:;|$)/i.test(String(headers['content-type']||'')))return;
      received=true;
      stream.feed(chunk);
    }
  });
  if(response.status!==200)throw new FlowError(providerRejectedBeforeExecution(response.status)?'PROVIDER_UNAVAILABLE':'MODEL_HTTP',`模型服务返回 HTTP ${response.status}，请检查模型、权限及额度`,response.status>=500&&!providerRejectedBeforeExecution(response.status));
  if(!/^text\/event-stream(?:;|$)/i.test(String(response.headers['content-type']||'')))throw new FlowError('MODEL_STREAM_UNSUPPORTED','模型服务未提供流式输出，请管理员测试或更换接口');
  if(!received)stream.feed(response.body);
  stream.feed(Buffer.alloc(0),true);
  return stream.result();
}

export async function generateSpeech(config:SecretSettings,text:string,voiceId:string,providerId:'standard'|'minimax',parameters:Record<string,string|number|boolean>={},transport:typeof requestBytes=requestBytes){
  const key=providerId==='minimax'?config.aggregateKey:config.minimaxKey;
  if(!key||!(providerId==='minimax'?config.minimax.aggregate&&config.minimax.enabled:config.independentAudioEnabled))throw new FlowError('PROVIDER_UNAVAILABLE','音频模型未配置或未启用');
  if(!config.minimax.voices.some(voice=>voice.id===voiceId))throw new FlowError('AUDIO_VOICE','所选音色不在管理员开放列表中');
  const voiceSetting=Object.fromEntries(Object.entries(parameters).filter(([name])=>['speed','vol','pitch'].includes(name)));
  const audioSetting=Object.fromEntries(Object.entries(parameters).filter(([name])=>['sample_rate','bitrate','format','channel'].includes(name)));
  const response=await transport((providerId==='minimax'?config.minimax.baseUrl:config.independentAudioBaseUrl)+'/t2a_v2',{
    method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify({model:config.minimax.speechModel,text,stream:false,voice_setting:{...voiceSetting,voice_id:voiceId},audio_setting:{sample_rate:32000,bitrate:128000,format:'mp3',channel:1,...audioSetting},output_format:'hex'}),
    trustedMiniMax:true,timeout:120000,maxBytes:20_000_000
  });
  if(response.status!==200)throw new FlowError(providerRejectedBeforeExecution(response.status)?'PROVIDER_UNAVAILABLE':'AUDIO_HTTP',`音频模型返回 HTTP ${response.status}`,response.status>=500&&!providerRejectedBeforeExecution(response.status));
  let provider:any;try{provider=JSON.parse(response.body.toString());}catch{throw new FlowError('AUDIO_RESPONSE','音频模型响应格式无效');}
  const code=provider?.base_resp?.status_code;
  if(code!==0){
    if([1002,1004,1008,1041,2013,20132,2042,2049,2056].includes(code))throw new FlowError('PROVIDER_UNAVAILABLE','当前音频连接明确拒绝请求');
    throw new FlowError('AUDIO_RESPONSE','音频模型未完成生成');
  }
  if(typeof provider.data?.audio!=='string')throw new FlowError('AUDIO_RESPONSE','音频模型未完成生成');
  return {bytes:response.body,mime:'application/json' as const,model:config.minimax.speechModel};
}
