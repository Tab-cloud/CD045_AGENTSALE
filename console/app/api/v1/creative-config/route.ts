import {session} from '../../../../lib/platform';
import { z } from 'zod';
import { creativeService } from '../../../../lib/creative-service';
import { requireLocal, failure, getAutomation } from '../../../../lib/local-runtime';
import { jsonBody } from '../../../../lib/server-access';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function GET(request: Request) {
  try { await session(request,false,true); return Response.json(await (await creativeService()).configuration(), {headers:{'Cache-Control':'no-store'}}); } catch(e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    const actor=await session(request,true,true);
    const body=z.object({revision:z.string().min(1),config:z.unknown(),imageKey:z.string().max(4000).optional(),videoKey:z.string().max(4000).optional()}).strict().parse(await jsonBody(request));
    const configuration=await (await creativeService()).configure(body.config,body.imageKey,body.videoKey,body.revision);
    await (await getAutomation()).store.audit('creative.configure',actor.id,'管理员更新图片、视频与本地数字人服务配置；不记录密钥');
    return Response.json(configuration);
  } catch(e) { if(e instanceof z.ZodError)return Response.json({message:'创作服务配置格式无效'},{status:400}); return failure(e); }
}
