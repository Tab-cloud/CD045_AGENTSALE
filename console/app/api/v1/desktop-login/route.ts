import {createHash} from 'node:crypto';
import {z} from 'zod';
import {boundary,platform,session} from '../../../../lib/platform';
import {failure} from '../../../../lib/local-runtime';
import {jsonBody} from '../../../../lib/server-access';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const input=z.discriminatedUnion('action',[
  z.object({action:z.literal('start')}).strict(),
  z.object({action:z.literal('approve'),id:z.string().max(100),code:z.string().max(10)}).strict(),
  z.object({action:z.literal('poll'),id:z.string().max(100),secret:z.string().max(100)}).strict(),
  z.object({action:z.literal('cancel'),id:z.string().max(100),secret:z.string().max(100)}).strict(),
]);

export async function POST(request:Request){
  try{
    boundary(request,true);
    const body=input.parse(await jsonBody(request,1000)),p=await platform();
    if(body.action==='start'){
      const source=request.headers.get('x-real-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';
      const requesterHash=createHash('sha256').update(source).digest('hex');
      const link=await p.auth.beginDesktopLogin(requesterHash);
      const origin=process.env.LINGFENG_PUBLIC_URL||new URL(request.url).origin;
      const url=new URL('/desktop-connect',origin);
      url.searchParams.set('request',link.id);
      return Response.json({...link,url:url.href},{headers:{'Cache-Control':'no-store'}});
    }
    if(body.action==='approve'){
      const user=await session(request,true);
      await p.auth.approveDesktopLogin(body.id,body.code,user.id);
      return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
    }
    if(body.action==='cancel'){
      await p.auth.cancelDesktopLogin(body.id,body.secret);
      return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
    }
    const result=await p.auth.pollDesktopLogin(body.id,body.secret);
    return Response.json(result.status==='pending'?result:{...result,subscription:await p.members.status(result.user.id)},{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    if(error instanceof z.ZodError)return Response.json({message:'桌面连接参数无效'},{status:400});
    return failure(error);
  }
}
