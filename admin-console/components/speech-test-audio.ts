export function decodeSpeechAudio(payload:unknown):Uint8Array{
  if(!payload||typeof payload!=='object')throw new Error('音频服务响应格式无效');
  const response=payload as {base_resp?:{status_code?:unknown};data?:{status?:unknown;audio?:unknown}};
  if(response.base_resp?.status_code!==0||response.data?.status!==2)throw new Error('音频服务未完成生成，请检查模型和音色权限');
  const hex=response.data.audio;
  if(typeof hex!=='string'||hex.length===0||hex.length%2!==0||!/^[0-9a-f]+$/i.test(hex))throw new Error('音频服务返回的音频数据无效');
  const bytes=new Uint8Array(hex.length/2);
  for(let i=0;i<bytes.length;i++)bytes[i]=Number.parseInt(hex.slice(i*2,i*2+2),16);
  return bytes;
}
