import { createAuth } from '@agentsale/automation';
import { LOCAL_WORKSPACE } from '@agentsale/database';
import { DomainError } from '@agentsale/domain';
import { getRepository,requireLocal } from './local-runtime';
export const token=(request:Request)=>request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('agentsale-session='))?.slice('agentsale-session='.length);
export async function auth(){return createAuth(await getRepository(),LOCAL_WORKSPACE);}
export async function access(request:Request,mutation=false,role?:true|'admin'|'operator'){requireLocal(request,mutation);return (await auth()).require(token(request),role);}
export async function jsonBody(request:Request,max=100000){
  if(Number(request.headers.get('content-length'))>max)throw new DomainError('INPUT_TOO_LARGE','提交内容过大',413);
  const reader=request.body?.getReader();if(!reader)throw new DomainError('INPUT_EMPTY','缺少提交内容');let size=0;const parts:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new DomainError('INPUT_TOO_LARGE','提交内容过大',413);}parts.push(value);}
  try{return JSON.parse(Buffer.concat(parts).toString());}catch{throw new DomainError('INVALID_JSON','提交内容无效');}
}
