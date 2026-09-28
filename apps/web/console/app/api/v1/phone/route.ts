import {createHash} from 'node:crypto';
import {z} from 'zod';
import {boundary,platform,session} from '../../../../lib/platform';
import {failure} from '../../../../lib/local-runtime';
import {jsonBody} from '../../../../lib/server-access';
export const runtime='nodejs';export const dynamic='force-dynamic';
const input=z.discriminatedUnion('action',[z.object({action:z.literal('send'),phone:z.string().max(20),purpose:z.enum(['register','bind'])}).strict(),z.object({action:z.literal('bind'),phone:z.string().max(20),code:z.string().max(10)}).strict()]);
export async function POST(request:Request){try{boundary(request,true);const body=input.parse(await jsonBody(request,2000)),p=await platform();if(body.action==='bind'){if(!(await p.authServices.configuration()).sms.enabled)return Response.json({message:'短信绑定尚未启用'},{status:503});const user=await session(request,true);await p.auth.bindPhone(user.id,body.phone,body.code,p.authServices.codeHash);return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});}if(body.purpose==='bind')await session(request,true);const source=request.headers.get('x-real-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]||'unknown',requesterHash=createHash('sha256').update(source).digest('hex');await p.auth.requestPhoneCode(body.phone,body.purpose,requesterHash,p.authServices.sendSms,p.authServices.codeHash);return Response.json({ok:true,message:'验证码已发送，5 分钟内有效'},{headers:{'Cache-Control':'no-store'}});}catch(error){if(error instanceof z.ZodError)return Response.json({message:'手机号或验证码参数无效'},{status:400});return failure(error);}}
