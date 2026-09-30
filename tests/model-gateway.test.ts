import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {generateText,generateSpeech,textGenerationSchema} from '../packages/automation/src/model-gateway';
import {defaults,type SecretSettings} from '../packages/automation/src/types';
import type {requestBytes} from '../packages/automation/src/network';

const config:SecretSettings={...defaults,baseUrl:'http://127.0.0.1:12345/v1',localModel:true,model:'fixture-model',format:'json_object',apiKey:'',minimaxKey:'',aggregateKey:'',verifiedAt:null,revision:'fixture'};
const request=()=>textGenerationSchema.parse({action:'text.generate',providerId:'standard',id:randomUUID(),messages:[{role:'system',content:'Desktop-owned task policy'},{role:'user',content:'Summarize fixture'}],jsonSchema:{type:'object',properties:{summary:{type:'string'}},required:['summary'],additionalProperties:false}});
it('passes desktop messages unchanged and returns provider text without server business prompts',async()=>{
  let sent:unknown;
  const transport:typeof requestBytes=async(_url,options)=>{sent=JSON.parse(String(options.body));expect(options).toMatchObject({idleTimeout:600_000,maxDuration:1_800_000});return {status:200,headers:{'content-type':'text/event-stream'},body:Buffer.from('data: '+JSON.stringify({model:'fixture-model',choices:[{delta:{content:'{"summary":'}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{content:'"完成"}'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'),url:_url};};
  const result=await generateText(config,request(),transport);
  expect(result.text).toBe('{"summary":"完成"}');
  expect(sent).toMatchObject({model:'fixture-model',stream:true,messages:[{role:'system',content:'Desktop-owned task policy'},{role:'user',content:'Summarize fixture'}],response_format:{type:'json_object'}});
  expect(JSON.stringify(sent)).not.toContain('AgentSale, an evidence-based');
});
it('forwards complete text deltas as provider bytes arrive across network chunk boundaries',async()=>{
  const data='data: '+JSON.stringify({choices:[{delta:{content:'分段'},finish_reason:null}]})+'\n\n'
    +'data: '+JSON.stringify({choices:[{delta:{content:'完成'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n';
  const bytes=Buffer.from(data),seen:string[]=[];
  const transport:typeof requestBytes=async(url,options)=>{
    const headers={'content-type':'text/event-stream'};
    for(const chunk of [bytes.subarray(0,13),bytes.subarray(13,41),bytes.subarray(41)])options.onChunk?.(chunk,200,headers);
    return {status:200,headers,body:bytes,url};
  };
  const result=await generateText(config,request(),transport,delta=>seen.push(delta));
  expect(seen).toEqual(['分段','完成']);
  expect(result.text).toBe('分段完成');
});
it('rejects invalid provider success bodies without fabricating a result',async()=>{
  const transport:typeof requestBytes=async(url)=>({status:200,headers:{'content-type':'application/json'},body:Buffer.from('<html>not a model reply</html>'),url});
  await expect(generateText(config,request(),transport)).rejects.toMatchObject({code:'MODEL_STREAM_UNSUPPORTED'});
});
it('keeps incomplete streams and truncated answers out of completed results',async()=>{
  const events='data: '+JSON.stringify({choices:[{delta:{content:'partial'}}]})+'\n\n';
  const transport:typeof requestBytes=async(url)=>({status:200,headers:{'content-type':'text/event-stream'},body:Buffer.from(events),url});
  await expect(generateText(config,request(),transport)).rejects.toMatchObject({code:'MODEL_STREAM_INCOMPLETE',retryable:true});
  const truncated:typeof requestBytes=async(url)=>({status:200,headers:{'content-type':'text/event-stream'},body:Buffer.from(events+'data: '+JSON.stringify({choices:[{delta:{},finish_reason:'length'}]})+'\n\ndata: [DONE]\n\n'),url});
  await expect(generateText(config,request(),truncated)).rejects.toMatchObject({code:'MODEL_TRUNCATED'});
});
it('accepts a MiniMax stream that cleanly ends after finish_reason stop without a DONE sentinel',async()=>{
  const combined={...config,aggregateKey:'minimax-key',minimax:{...config.minimax,aggregate:true,textModel:'MiniMax-M3'}};
  const events='data: '+JSON.stringify({model:'MiniMax-M3',choices:[{delta:{content:'{"ready":'},finish_reason:null}]})+'\n\n'
    +'data: '+JSON.stringify({choices:[{delta:{content:'true}'},finish_reason:'stop'}],base_resp:{status_code:0}})+'\n\n';
  const transport:typeof requestBytes=async(url,options)=>{
    const headers={'content-type':'text/event-stream; charset=utf-8'};
    const bytes=Buffer.from(events);
    for(const chunk of [bytes.subarray(0,25),bytes.subarray(25)])options.onChunk?.(chunk,200,headers);
    return {status:200,headers,body:Buffer.alloc(0),url};
  };
  await expect(generateText(combined,{...request(),providerId:'minimax'},transport)).resolves.toMatchObject({text:'{"ready":true}',model:'MiniMax-M3'});
});
it('reports a MiniMax business error instead of calling it an interrupted stream',async()=>{
  const combined={...config,aggregateKey:'minimax-key',minimax:{...config.minimax,aggregate:true,textModel:'MiniMax-M3'}};
  const transport:typeof requestBytes=async(url,options)=>{
    const headers={'content-type':'text/event-stream'};
    options.onChunk?.(Buffer.from('data: '+JSON.stringify({base_resp:{status_code:1004,status_msg:'sensitive provider text'}})+'\n\n'),200,headers);
    return {status:200,headers,body:Buffer.alloc(0),url};
  };
  await expect(generateText(combined,{...request(),providerId:'minimax'},transport)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',message:'MiniMax 返回错误码 1004：请检查 API 密钥及模型权限',retryable:false});
});
it('preserves the provider speech response byte for byte',async()=>{
  const audio=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(12,1)]);
  let authorization='',sent:any;
  const raw=Buffer.from(' {"base_resp":{"status_code":0},"data":{"status":2,"audio":"'+audio.toString('hex')+'"}}\n');
  const transport:typeof requestBytes=async(url,options)=>{authorization=String(options.headers?.Authorization);sent=JSON.parse(String(options.body));return {status:200,headers:{},body:raw,url};};
  const result=await generateSpeech({...config,independentAudioEnabled:true,minimaxKey:'fixture-secret'},'你好',config.minimax.voices[0].id,'standard',{speed:1.2,bitrate:128000},transport);
  expect(result.mime).toBe('application/json');
  expect(result.bytes).toEqual(raw);expect(authorization).toBe('Bearer fixture-secret');
  expect(sent.voice_setting).toMatchObject({voice_id:config.minimax.voices[0].id,speed:1.2});
  expect(sent.audio_setting.bitrate).toBe(128000);
  await expect(generateSpeech({...config,independentAudioEnabled:true,minimaxKey:'fixture-secret'},'你好','forbidden','standard',{},transport)).rejects.toMatchObject({code:'AUDIO_VOICE'});
});
it('allows audio routing to continue when an account explicitly lacks the selected voice',async()=>{
  const rejected:typeof requestBytes=async(url)=>({status:200,headers:{},body:Buffer.from(JSON.stringify({base_resp:{status_code:2042,status_msg:'no access'}})),url});
  await expect(generateSpeech({...config,independentAudioEnabled:true,minimaxKey:'fixture-secret'},'你好',config.minimax.voices[0].id,'standard',{},rejected)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',retryable:false});
});
it('routes aggregate text with its own credential and only marks explicit rejection safe for fallback',async()=>{
  const combined={...config,apiKey:'ordinary-key',aggregateKey:'minimax-key',minimax:{...config.minimax,aggregate:true,textModel:'MiniMax-M3'}};
  let url='',authorization='',model='';
  const unavailable:typeof requestBytes=async(next,options)=>{url=next;authorization=String(options.headers?.Authorization);model=JSON.parse(String(options.body)).model;return {status:429,headers:{},body:Buffer.alloc(0),url:next};};
  await expect(generateText(combined,{...request(),providerId:'minimax'},unavailable)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',retryable:false});
  expect(url).toBe(config.minimax.baseUrl+'/chat/completions');expect(authorization).toBe('Bearer minimax-key');expect(model).toBe('MiniMax-M3');
  const rejected:typeof requestBytes=async(next)=>({status:401,headers:{},body:Buffer.alloc(0),url:next});
  await expect(generateText(combined,{...request(),providerId:'minimax'},rejected)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',retryable:false});
  const ambiguous:typeof requestBytes=async(next)=>({status:502,headers:{},body:Buffer.alloc(0),url:next});
  await expect(generateText(combined,{...request(),providerId:'minimax'},ambiguous)).rejects.toMatchObject({code:'MODEL_HTTP',retryable:true});
  const serviceUnavailable:typeof requestBytes=async(next)=>({status:503,headers:{},body:Buffer.alloc(0),url:next});
  await expect(generateText(combined,{...request(),providerId:'minimax'},serviceUnavailable)).rejects.toMatchObject({code:'MODEL_HTTP',retryable:true});
  const uncertain:typeof requestBytes=async(next)=>{throw new Error('connection lost after submit')};
  await expect(generateText(combined,{...request(),providerId:'minimax'},uncertain)).rejects.toThrow('connection lost');
});
