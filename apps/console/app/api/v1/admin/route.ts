import { z } from 'zod';
import { safeSettings,mediaHealth,connectorIds,connectorSecretKeys } from '@agentsale/automation';
import { validUrl } from '../../../../../../packages/automation/src/network';
import { failure,getAutomation,requireLocal } from '../../../../lib/local-runtime';
import { jsonBody } from '../../../../lib/server-access';
export const runtime='nodejs';export const dynamic='force-dynamic';
const command=z.discriminatedUnion('action',[
  z.object({action:z.literal('save'),settings:z.unknown(),apiKey:z.string().max(4000).optional(),searchKey:z.string().max(4000).optional(),minimaxKey:z.string().max(4000).optional(),connectorSecrets:z.partialRecord(z.enum(connectorSecretKeys),z.string().max(4000)).optional(),preserveApiKey:z.boolean().optional()}).strict(),
  z.object({action:z.literal('verify')}).strict(),
  z.object({action:z.literal('verifyConnector'),connector:z.enum(connectorIds)}).strict(),
  z.object({action:z.literal('beginAuthorization'),connector:z.enum(['tiktok_shop','temu'])}).strict()
]);
export async function GET(request:Request){try{requireLocal(request);const engine=await getAutomation();return Response.json({settings:safeSettings(await engine.vault.get()),connectors:await engine.commerce.statuses(),authorizations:await engine.commerce.records('authorization'),spend:await engine.store.spend(),renderer:await mediaHealth()},{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
export async function POST(request:Request){try{requireLocal(request,true);const body=command.parse(await jsonBody(request)),engine=await getAutomation();
  if(body.action==='save'){const s=body.settings as {baseUrl:string;localModel:boolean};validUrl(s.baseUrl,s.localModel);const settings=await engine.vault.save(body.settings,body.apiKey,body.searchKey,body.minimaxKey,body.connectorSecrets,body.preserveApiKey);await engine.store.audit('provider.configure','local-console','本机管理控制台更新服务与连接器配置，验证已失效');return Response.json({settings,message:'配置已保存，请验证已启用的连接器'});}
  if(body.action==='verify')return Response.json({...await engine.verify(),message:'模型调用及结构化输出已验证'});
  if(body.action==='verifyConnector'){const connector=await engine.commerce.verify(body.connector);await engine.store.audit('connector.verify',body.connector,'本机管理控制台验证连接器');return Response.json({connector,message:`${body.connector} 已通过真实接口验证`});}
  const authorization=await engine.commerce.beginAuthorization(body.connector);await engine.store.audit('connector.authorize.start',body.connector,'本机管理控制台启动平台授权');return Response.json({...authorization,message:'正在打开平台授权页面'});
}catch(e){if(e instanceof z.ZodError)return Response.json({message:'管理操作参数无效'},{status:400});return failure(e);}}
