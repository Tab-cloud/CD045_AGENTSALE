import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {generateText,generateSpeech,textGenerationSchema} from '../packages/automation/src/model-gateway';
import {defaults,type SecretSettings} from '../packages/automation/src/types';
import type {requestBytes} from '../packages/automation/src/network';

const config:SecretSettings={...defaults,baseUrl:'http://127.0.0.1:12345/v1',localModel:true,model:'fixture-model',format:'json_object',apiKey:'',minimaxKey:'',verifiedAt:null,revision:'fixture'};
const request=()=>textGenerationSchema.parse({action:'text.generate',id:randomUUID(),messages:[{role:'system',content:'Desktop-owned task policy'},{role:'user',content:'Summarize fixture'}],jsonSchema:{type:'object',properties:{summary:{type:'string'}},required:['summary'],additionalProperties:false}});
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
it('decodes bounded speech output from the configured audio model',async()=>{
  const audio=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(12,1)]);
  let authorization='';
  const transport:typeof requestBytes=async(url,options)=>{authorization=String(options.headers?.Authorization);return {status:200,headers:{},body:Buffer.from(JSON.stringify({base_resp:{status_code:0},data:{status:2,audio:audio.toString('hex')},extra_info:{usage_characters:2,audio_length:300}})),url};};
  const result=await generateSpeech({...config,minimaxKey:'fixture-secret',minimax:{...config.minimax,enabled:true}},'你好',transport);
  expect(result).toMatchObject({mime:'audio/mpeg',usage:{characters:2,durationMs:300}});
  expect(result.bytes).toEqual(audio);expect(authorization).toBe('Bearer fixture-secret');
});
