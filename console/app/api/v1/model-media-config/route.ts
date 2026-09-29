import {session} from '../../../../lib/platform';
import { z } from 'zod';
import { modelMediaService } from '../../../../lib/model-media-service';
import {failure,auditConfiguration} from '../../../../lib/local-runtime';
import { jsonBody } from '../../../../lib/server-access';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function GET(request: Request) {
  try { await session(request,false,true); return Response.json(await (await modelMediaService()).configuration(), {headers:{'Cache-Control':'no-store'}}); } catch(e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    const actor=await session(request,true,true);
    const body=z.object({revision:z.string().min(1),config:z.unknown(),imageKey:z.string().max(4000).optional(),videoKey:z.string().max(4000).optional()}).strict().parse(await jsonBody(request));
    const configuration=await (await modelMediaService()).configure(body.config,body.imageKey,body.videoKey,body.revision);
    await auditConfiguration('model.media.configure',actor.id,'管理员更新图片和视频模型配置；不记录密钥');
    return Response.json(configuration);
  } catch(e) { if(e instanceof z.ZodError)return Response.json({message:'创作服务配置格式无效'},{status:400}); return failure(e); }
}
