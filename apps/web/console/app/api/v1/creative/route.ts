import {editPlanSchema} from '../../../../../packages/automation/src/video-edit';
import {z} from 'zod';
import {creativeService} from '../../../../lib/creative-service';
import {failure} from '../../../../lib/local-runtime';
import {session,platform} from '../../../../lib/platform';
import {jsonBody} from '../../../../lib/server-access';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await session(request),p=await platform(),service=await creativeService(user.id),id=new URL(request.url).searchParams.get('asset');if(id){await p.members.ownAsset(z.string().uuid().parse(id),user.id);const asset=await service.asset(id);return new Response(new Uint8Array(asset.bytes),{headers:{'Content-Type':asset.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}const capabilities=await service.capabilities(),status=await p.members.status(user.id);return Response.json({...capabilities,videoEditing:capabilities.videoEditing&&status.features.includes('video'),referenceEditing:capabilities.referenceEditing&&status.features.includes('image'),image:capabilities.image&&status.features.includes('image'),video:capabilities.video&&status.features.includes('video'),avatar:capabilities.avatar&&status.features.includes('video')},{headers:{'Cache-Control':'no-store'}});}catch(e){if(e instanceof z.ZodError)return Response.json({message:'作品编号无效'},{status:400});return failure(e);}}
export async function POST(request:Request){
  try {
    const user=await session(request,true),p=await platform();
    const b=z.discriminatedUnion('action',[
      z.object({action:z.literal('start'),id:z.string().uuid(),kind:z.enum(['image','video','avatar']),prompt:z.string().trim().min(1).max(2500),portraitId:z.string().uuid().optional(),referenceId:z.string().uuid().optional(),editPlan:editPlanSchema.optional()}).strict(),
      z.object({action:z.literal('portrait'),data:z.string().min(1).max(5_333_336)}).strict(),
      z.object({action:z.literal('videoSource'),data:z.string().min(1).max(26_666_668),name:z.string().min(1).max(250)}).strict(),
      z.object({action:z.literal('reference'),data:z.string().min(1).max(5_333_336)}).strict(),
      z.object({action:z.literal('poll'),id:z.string().uuid()}).strict()
    ]).parse(await jsonBody(request,27_000_000));
    const service=await creativeService(user.id);
    if(b.action==='portrait'){await p.members.requireFeature(user.id,'video');return Response.json(await service.importPortrait(b.data),{headers:{'Cache-Control':'no-store'}});}
    if(b.action==='videoSource'){await p.members.requireFeature(user.id,'video');return Response.json(await service.importVideo(b.data,b.name),{headers:{'Cache-Control':'no-store'}});}
    if(b.action==='reference'){
      await p.members.requireFeature(user.id,'image');
      return Response.json(await service.importReference(b.data),{headers:{'Cache-Control':'no-store'}});
    }
    if(b.action==='start'){
      await p.members.requireFeature(user.id,b.kind==='avatar'?'video':b.kind);
      if(b.referenceId){if(b.kind!=='image')return Response.json({message:'参考图仅用于图片'},{status:400});await service.validateReference(b.referenceId);}
      if(b.portraitId)await service.validatePortrait(b.portraitId);
      if(b.editPlan){if(b.kind!=='video')return Response.json({message:'剪辑仅支持视频'},{status:400});await service.validateEdit(b.editPlan);}
      await p.members.claimAsset(b.id,user.id,b.kind==='avatar'?'video':b.kind);
    }else await p.members.ownAsset(b.id,user.id);
    const job=b.action==='start'?await service.start({id:b.id,kind:b.kind,prompt:b.prompt,...(b.portraitId?{portraitId:b.portraitId}:{}),...(b.referenceId?{referenceId:b.referenceId}:{}),...(b.editPlan?{editPlan:b.editPlan}:{})}):await service.poll(b.id);
    const {fingerprint:_,file:__,...publicJob}=job;
    return Response.json(publicJob,{headers:{'Cache-Control':'no-store'}});
  }catch(e){if(e instanceof z.ZodError)return Response.json({message:'创作参数无效'},{status:400});return failure(e);}
}
