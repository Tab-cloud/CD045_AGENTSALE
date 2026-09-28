import {z} from 'zod';
import {platform,session} from '../../../../lib/platform';
import {failure,getAutomation} from '../../../../lib/local-runtime';
import {jsonBody} from '../../../../lib/server-access';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){try{await session(request,false,true);return Response.json(await (await platform()).authServices.configuration(),{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
export async function POST(request:Request){try{const actor=await session(request,true,true),body=z.object({revision:z.string().min(1),config:z.unknown()}).strict().parse(await jsonBody(request,12000)),result=await (await platform()).authServices.configure(body.config,body.revision);await (await getAutomation()).store.audit('auth-services.configure',actor.id,'管理员更新短信与微信登录服务；不记录密钥');return Response.json(result,{headers:{'Cache-Control':'no-store'}});}catch(error){if(error instanceof z.ZodError)return Response.json({message:'登录服务配置格式无效'},{status:400});return failure(error);}}
