import {expect,it} from 'vitest';
import {listMiniMaxVoices} from '../packages/automation/src/voice-catalog';
import {defaults,type SecretSettings} from '../packages/automation/src/types';
import type {requestBytes} from '../packages/automation/src/network';

const settings:SecretSettings={...defaults,apiKey:'',minimaxKey:'independent-secret',aggregateKey:'aggregate-secret',verifiedAt:null,revision:'test'};
const providerReply={base_resp:{status_code:0,status_msg:'success'},system_voice:[{voice_id:'system-1',voice_name:'系统音色'}],voice_cloning:[{voice_id:'clone-1'},{voice_id:'system-1',voice_name:'重复'}],voice_generation:[{voice_id:'generated-1',voice_name:'生成音色'}]};

it('queries all voice categories with the saved credential for each connection',async()=>{
  const sent:{url:string;authorization:string;body:string}[]=[];
  const transport:typeof requestBytes=async(url,options)=>{
    expect(options).toMatchObject({method:'POST',trustedMiniMax:true,timeout:20_000});
    sent.push({url,authorization:String(options.headers?.Authorization),body:String(options.body)});
    return {status:200,headers:{},body:Buffer.from(JSON.stringify(providerReply)),url};
  };
  const independent=await listMiniMaxVoices(settings,'standard',transport);
  const aggregate=await listMiniMaxVoices(settings,'minimax',transport);
  expect(sent).toEqual([
    {url:settings.independentAudioBaseUrl+'/get_voice',authorization:'Bearer independent-secret',body:'{"voice_type":"all"}'},
    {url:settings.minimax.baseUrl+'/get_voice',authorization:'Bearer aggregate-secret',body:'{"voice_type":"all"}'}
  ]);
  expect(independent).toEqual([
    {id:'system-1',name:'系统音色',source:'system'},
    {id:'clone-1',name:'clone-1',source:'voice_cloning'},
    {id:'generated-1',name:'生成音色',source:'voice_generation'}
  ]);
  expect(aggregate).toEqual(independent);
});

it('requires a saved key and rejects provider failures without exposing response data',async()=>{
  const unused:typeof requestBytes=async()=>{throw new Error('transport should not run');};
  await expect(listMiniMaxVoices({...settings,minimaxKey:''},'standard',unused)).rejects.toMatchObject({code:'VOICE_KEY_MISSING'});
  const failed:typeof requestBytes=async(url)=>({status:200,headers:{},body:Buffer.from(JSON.stringify({...providerReply,base_resp:{status_code:1004,status_msg:'secret echoed here'}})),url});
  await expect(listMiniMaxVoices(settings,'standard',failed)).rejects.toMatchObject({code:'VOICE_QUERY_FAILED',message:'MiniMax 未能返回音色，请检查密钥及音色查询权限'});
  const invalid:typeof requestBytes=async(url)=>({status:200,headers:{},body:Buffer.from(JSON.stringify({...providerReply,system_voice:[{voice_id:'bad|id'}]})),url});
  await expect(listMiniMaxVoices(settings,'standard',invalid)).rejects.toMatchObject({code:'VOICE_RESPONSE_INVALID'});
});
