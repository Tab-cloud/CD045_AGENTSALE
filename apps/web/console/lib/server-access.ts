import type {User} from '@agentsale/automation';
import { DomainError } from '@agentsale/domain';
import {requireLocal} from './local-runtime';
// Legacy workspace endpoints are administrative until their shared data is migrated.
import {session} from './platform';
export async function access(request:Request,mutation=false,_role?:true|'admin'|'operator'){
  if(process.env.LINGFENG_PUBLIC_URL)throw new DomainError('LEGACY_API_DISABLED','业务任务已迁移至桌面端',404);
  return session(request,mutation,true);
}
export async function jsonBody(request:Request,max=100000){
  if(Number(request.headers.get('content-length'))>max)throw new DomainError('INPUT_TOO_LARGE','提交内容过大',413);
  const reader=request.body?.getReader();if(!reader)throw new DomainError('INPUT_EMPTY','缺少提交内容');let size=0;const parts:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new DomainError('INPUT_TOO_LARGE','提交内容过大',413);}parts.push(value);}
  try{return JSON.parse(Buffer.concat(parts).toString());}catch{throw new DomainError('INVALID_JSON','提交内容无效');}
}
