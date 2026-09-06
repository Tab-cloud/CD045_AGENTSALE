import type {User} from '@agentsale/automation';
import { DomainError } from '@agentsale/domain';
import {requireLocal} from './local-runtime';
export const localOperator:User={id:'00000000-0000-4000-8000-000000000045',username:'本机用户',role:'operator',enabled:true};
export async function access(request:Request,mutation=false,role?:true|'admin'|'operator'){requireLocal(request,mutation);if(role===true||role==='admin')throw new DomainError('FORBIDDEN','管理入口使用独立本机接口',403);return localOperator;}
export async function jsonBody(request:Request,max=100000){
  if(Number(request.headers.get('content-length'))>max)throw new DomainError('INPUT_TOO_LARGE','提交内容过大',413);
  const reader=request.body?.getReader();if(!reader)throw new DomainError('INPUT_EMPTY','缺少提交内容');let size=0;const parts:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new DomainError('INPUT_TOO_LARGE','提交内容过大',413);}parts.push(value);}
  try{return JSON.parse(Buffer.concat(parts).toString());}catch{throw new DomainError('INVALID_JSON','提交内容无效');}
}
