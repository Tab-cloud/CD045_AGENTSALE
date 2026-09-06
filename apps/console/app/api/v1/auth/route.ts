import { z } from 'zod';
import { failure,requireLocal } from '../../../../lib/local-runtime';
import { auth,token,jsonBody } from '../../../../lib/server-access';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){try{requireLocal(request);const service=await auth();return Response.json({setupNeeded:await service.setupNeeded(),user:await service.user(token(request))},{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
const credentials=z.object({action:z.enum(['setup','login','logout']),username:z.string().max(40).optional(),password:z.string().max(128).optional()}).strict();
export async function POST(request:Request){try{
  requireLocal(request,true);const body=credentials.parse(await jsonBody(request,2000)),service=await auth();
  if(body.action==='logout'){await service.logout(token(request));return Response.json({ok:true},{headers:{'Set-Cookie':'agentsale-session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'}});}
  if(body.action==='setup')await service.create(body.username||'',body.password||'','admin');
  const result=await service.login(body.username||'',body.password||'');
  return Response.json({user:result.user},{headers:{'Cache-Control':'no-store','Set-Cookie':`agentsale-session=${result.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`}});
}catch(e){if(e instanceof z.ZodError)return Response.json({message:'登录参数无效'},{status:400});return failure(e);}}
