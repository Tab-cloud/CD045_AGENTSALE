import {requestBytes} from './network';
import {FlowError,type SecretSettings} from './types';

export type VoiceSource='system'|'voice_cloning'|'voice_generation';
export type AvailableVoice={id:string;name:string;source:VoiceSource};

// Voice discovery is an administrator-only lookup. It never changes the
// curated list exposed to desktop clients until the administrator saves it.
export async function listMiniMaxVoices(
  settings:SecretSettings,
  providerId:'standard'|'minimax',
  transport:typeof requestBytes=requestBytes
):Promise<AvailableVoice[]>{
  const key=providerId==='minimax'?settings.aggregateKey:settings.minimaxKey;
  const baseUrl=providerId==='minimax'?settings.minimax.baseUrl:settings.independentAudioBaseUrl;
  if(!key)throw new FlowError('VOICE_KEY_MISSING','请先保存该连接的 MiniMax API 密钥');
  const url=baseUrl+'/get_voice';
  const response=await transport(url,{
    method:'POST',trustedMiniMax:true,timeout:20_000,maxBytes:2_000_000,
    headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify({voice_type:'all'})
  });
  if(response.status!==200)throw new FlowError('VOICE_QUERY_FAILED','MiniMax 音色查询失败（HTTP '+response.status+'），请检查密钥及音色查询权限');
  let body:unknown;
  try{body=JSON.parse(response.body.toString('utf8'));}catch{throw new FlowError('VOICE_RESPONSE_INVALID','MiniMax 返回了无效的音色数据');}
  if(!body||typeof body!=='object')throw new FlowError('VOICE_RESPONSE_INVALID','MiniMax 返回了无效的音色数据');
  const data=body as Record<string,unknown>;
  const baseResponse=data.base_resp;
  if(!baseResponse||typeof baseResponse!=='object'||(baseResponse as Record<string,unknown>).status_code!==0)
    throw new FlowError('VOICE_QUERY_FAILED','MiniMax 未能返回音色，请检查密钥及音色查询权限');
  const groups:[VoiceSource,string][]=[['system','system_voice'],['voice_cloning','voice_cloning'],['voice_generation','voice_generation']];
  const voices:AvailableVoice[]=[],seen=new Set<string>();
  for(const [source,field] of groups){
    const entries=data[field];
    if(!Array.isArray(entries))throw new FlowError('VOICE_RESPONSE_INVALID','MiniMax 返回的音色列表格式无效');
    for(const raw of entries){
      if(!raw||typeof raw!=='object')throw new FlowError('VOICE_RESPONSE_INVALID','MiniMax 返回的音色条目格式无效');
      const entry=raw as Record<string,unknown>;
      const id=typeof entry.voice_id==='string'?entry.voice_id.trim():'';
      const name=typeof entry.voice_name==='string'?entry.voice_name.trim():'';
      if(!id||id.length>100||/[|\r\n]/.test(id)||name.length>100)throw new FlowError('VOICE_RESPONSE_INVALID','MiniMax 返回的音色 ID 或名称无效');
      if(seen.has(id))continue;
      seen.add(id);voices.push({id,name:name||id,source});
    }
  }
  return voices;
}
