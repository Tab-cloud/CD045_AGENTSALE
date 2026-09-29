import { createAuth } from '@agentsale/automation';
import { LOCAL_WORKSPACE } from '@agentsale/database';
import { DomainError } from '@agentsale/domain';
import { createMembership } from '../../packages/automation/src/membership';
import { createPayments } from '../../packages/automation/src/payment';
import { createAuthServices } from './auth-services';
import { getRepository,getAutomation,requireLocal } from './local-runtime';
const runtime=globalThis as typeof globalThis & {lingfengPayments?:ReturnType<typeof createPayments>;lingfengAuthServices?:ReturnType<typeof createAuthServices>};
export async function platform(){const repo=await getRepository(),root=(await getAutomation()).root;return {auth:createAuth(repo,LOCAL_WORKSPACE),members:createMembership(repo,LOCAL_WORKSPACE),payments:runtime.lingfengPayments??=createPayments(root),authServices:runtime.lingfengAuthServices??=createAuthServices(root)};}
export function token(request:Request){const bearer=request.headers.get('authorization');if(bearer)return /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(bearer)?.[1];return /(?:^|;\s*)lingfeng_session=([A-Za-z0-9_-]{40,100})(?:;|$)/.exec(request.headers.get('cookie')||'')?.[1];}
export function boundary(request:Request,mutation=false){const publicOrigin=process.env.LINGFENG_PUBLIC_URL;if(!publicOrigin){requireLocal(request,mutation&&!request.headers.has('authorization'));return;}const origin=new URL(publicOrigin);if(origin.protocol!=='https:'||origin.pathname!=='/')throw new DomainError('PLATFORM_CONFIG','平台站点地址配置无效',503);if(request.headers.get('sec-fetch-site')==='cross-site'||mutation&&!request.headers.has('authorization')&&request.headers.get('origin')!==origin.origin)throw new DomainError('ORIGIN_REJECTED','请从平台页面提交',403);}
export async function session(request:Request,mutation=false,admin=false){boundary(request,mutation);return (await platform()).auth.require(token(request),admin?true:undefined);}
export function cookie(value:string){return `lingfeng_session=${value}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${value?28800:0}${process.env.LINGFENG_PUBLIC_URL?'; Secure':''}`;}
