import { z } from 'zod';
import { safeSettings,mediaHealth,connectorIds,connectorSecretKeys } from '@agentsale/automation';
import { validUrl } from '../../../../../../packages/automation/src/network';
import { failure,getAutomation } from '../../../../lib/local-runtime';
import { access,auth,jsonBody } from '../../../../lib/server-access';
export const runtime='nodejs';export const dynamic='force-dynamic';
const command=z.discriminatedUnion('action',[
  z.object({action:z.literal('save'),settings:z.unknown(),apiKey:z.string().max(4000).optional(),searchKey:z.string().max(4000).optional(),minimaxKey:z.string().max(4000).optional(),connectorSecrets:z.partialRecord(z.enum(connectorSecretKeys),z.string().max(4000)).optional()}).strict(),
  z.object({action:z.literal('verify')}).strict(),
  z.object({action:z.literal('verifyConnector'),connector:z.enum(connectorIds)}).strict(),
  z.object({action:z.literal('createUser'),username:z.string(),password:z.string(),role:z.enum(['admin','operator'])}).strict(),
  z.object({action:z.literal('disableUser'),id:z.string().uuid()}).strict()
]);
export async function GET(request:Request){try{await access(request,false,true);const engine=await getAutomation();return Response.json({settings:safeSettings(await engine.vault.get()),connectors:await engine.commerce.statuses(),users:await (await auth()).users(),spend:await engine.store.spend(),renderer:await mediaHealth()},{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
export async function POST(request:Request){try{const actor=await access(request,true,true),body=command.parse(await jsonBody(request)),engine=await getAutomation();
  if(body.action==='save'){const s=body.settings as {baseUrl:string;localModel:boolean};validUrl(s.baseUrl,s.localModel);const settings=await engine.vault.save(body.settings,body.apiKey,body.searchKey,body.minimaxKey,body.connectorSecrets);await engine.store.audit('provider.configure',actor.id,actor.username+' 更新服务与连接器配置，验证已失效');return Response.json({settings,message:'配置已保存，请验证已启用的连接器'});}
  if(body.action==='verify')return Response.json({...await engine.verify(),message:'模型调用及结构化输出已验证'});
  if(body.action==='verifyConnector'){const connector=await engine.commerce.verify(body.connector);await engine.store.audit('connector.verify',body.connector,actor.username+' 验证连接器');return Response.json({connector,message:`${body.connector} 已通过真实接口验证`});}
  if(body.action==='createUser')return Response.json({user:await (await auth()).create(body.username,body.password,body.role,actor),message:'账号已建立'});
  await (await auth()).disable(body.id,actor);return Response.json({message:'账号已停用，会话已撤销'});
}catch(e){if(e instanceof z.ZodError)return Response.json({message:'管理操作参数无效'},{status:400});return failure(e);}}
