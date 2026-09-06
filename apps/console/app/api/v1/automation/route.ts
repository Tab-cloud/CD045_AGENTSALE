import { z } from 'zod';
import { failure,getAutomation } from '../../../../lib/local-runtime';
import { access,jsonBody } from '../../../../lib/server-access';
export const runtime='nodejs';export const dynamic='force-dynamic';
const control=z.object({id:z.string().uuid(),action:z.enum(['pause','resume','cancel','approve']),version:z.number().int().positive()}).strict();
export async function GET(request:Request){try{await access(request,false,'operator');const engine=await getAutomation(),s=await engine.vault.get();return Response.json({jobs:await engine.store.list(),assets:await engine.store.assets(),capabilities:{model:!!s.verifiedAt&&Date.now()-Date.parse(s.verifiedAt)<86400000,search:!!s.searchKey,minimax:!!s.minimaxKey}},{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
export async function POST(request:Request){try{const user=await access(request,true,'operator'),body=await jsonBody(request),engine=await getAutomation();
  if(body.action==='create')return Response.json({job:await engine.store.create(body.input,user,request.headers.get('idempotency-key')||''),message:'自动化流程已启动'});
  if(body.action==='recoverVideo'){const c=z.object({action:z.literal('recoverVideo'),id:z.string().uuid(),version:z.number().int().positive(),taskId:z.string()}).strict().parse(body);return Response.json({job:await engine.store.recoverVideo(c.id,c.version,c.taskId,user),message:'任务号已保存，将查询原视频'});}
  if(body.action==='revise'){const c=z.object({action:z.literal('revise'),id:z.string().uuid(),version:z.number().int().positive(),copy:z.unknown()}).strict().parse(body);return Response.json({job:await engine.store.revise(c.id,c.version,c.copy,user),message:'修订已保存，将重新生成视频与文件；原审阅已失效'});}
  const c=control.parse(body);return Response.json({job:await engine.store.control(c.id,c.action,c.version,user),message:'流程状态已更新'});
}catch(e){if(e instanceof z.ZodError)return Response.json({message:'流程操作参数无效'},{status:400});return failure(e);}}
