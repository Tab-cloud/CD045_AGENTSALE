import {createHash} from 'node:crypto';
import {z} from 'zod';
import {boundary,platform,session,cookie} from '../../../../lib/platform';
import {failure} from '../../../../lib/local-runtime';
import {jsonBody} from '../../../../lib/server-access';
import {busyResponse,concurrencyGate} from '../../../../lib/concurrency';
export const runtime='nodejs';export const dynamic='force-dynamic';
const input=z.discriminatedUnion('action',[
  z.object({action:z.literal('send'),phone:z.string().max(20),purpose:z.enum(['register','bind','login','wechat'])}).strict(),
  z.object({action:z.literal('bind'),phone:z.string().max(20),code:z.string().max(10)}).strict(),
  z.object({action:z.literal('wechat-complete'),phone:z.string().max(20),code:z.string().max(10)}).strict(),
  z.object({action:z.literal('wechat-register'),username:z.string().max(40),password:z.string().max(128)}).strict()
]);
const pendingToken=(request:Request)=>/(?:^|;\s*)lingfeng_wechat_pending=([A-Za-z0-9_-]{40,100})(?:;|$)/.exec(request.headers.get('cookie')||'')?.[1]||'';
const clearPending=`lingfeng_wechat_pending=; HttpOnly; Path=/api/v1/phone; SameSite=Strict; Max-Age=0${process.env.LINGFENG_PUBLIC_URL?'; Secure':''}`;
export async function POST(request:Request){try{
  boundary(request,true);const body=input.parse(await jsonBody(request,2000)),p=await platform();
  if(!(await p.authServices.configuration()).sms.enabled)return Response.json({message:'短信服务尚未启用'},{status:503});
  if(body.action==='bind'){const user=await session(request,true);await p.auth.bindPhone(user.id,body.phone,body.code,p.authServices.codeHash);return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});}
  if(body.action==='wechat-complete'){
    const result=await p.auth.completeWechatPhone(pendingToken(request),body.phone,body.code,p.authServices.codeHash);
    if(result.registrationRequired)return Response.json({registrationRequired:true},{headers:{'Cache-Control':'no-store'}});
    const headers=new Headers({'Cache-Control':'no-store'});headers.append('Set-Cookie',cookie(result.token));headers.append('Set-Cookie',clearPending);
    return Response.json({user:result.user,subscription:await p.members.status(result.user.id)},{headers});
  }
  if(body.action==='wechat-register'){
    const result=await p.auth.finishWechatRegistration(pendingToken(request),body.username,body.password);
    const headers=new Headers({'Cache-Control':'no-store'});headers.append('Set-Cookie',cookie(result.token));headers.append('Set-Cookie',clearPending);
    return Response.json({user:result.user,subscription:await p.members.status(result.user.id)},{headers});
  }
  if(body.purpose==='bind')await session(request,true);
  if(body.purpose==='wechat')await p.auth.requireWechatPending(pendingToken(request));
  const source=request.headers.get('x-real-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]||'unknown',requesterHash=createHash('sha256').update(source).digest('hex');
  const release=concurrencyGate.tryAcquire('sms');
  if(!release)return busyResponse();
  try{
    await p.auth.requestPhoneCode(body.phone,body.purpose,requesterHash,p.authServices.sendSms,p.authServices.codeHash);
    return Response.json({ok:true,message:'验证码已发送，5 分钟内有效'},{headers:{'Cache-Control':'no-store'}});
  }finally{release();}
}catch(error){if(error instanceof z.ZodError)return Response.json({message:'手机号或验证码参数无效'},{status:400});return failure(error);}}
