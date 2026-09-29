import {session} from '../../../../lib/platform';
import { z } from 'zod';
import { safeSettings,settingsSchema } from '@agentsale/automation';
import { validUrl } from '../../../../../packages/automation/src/network';
import {failure,modelVault,verifyConfiguredModel,auditConfiguration} from '../../../../lib/local-runtime';
import { jsonBody } from '../../../../lib/server-access';
export const runtime='nodejs';export const dynamic='force-dynamic';
const command=z.discriminatedUnion('action',[
  z.object({action:z.literal('save'),revision:z.string().min(1),settings:z.unknown(),apiKey:z.string().max(4000).optional(),minimaxKey:z.string().max(4000).optional()}).strict(),
  z.object({action:z.literal('verify')}).strict()
]);
export async function GET(request:Request){try{await session(request,false,true);return Response.json({settings:safeSettings(await (await modelVault()).get())},{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
export async function POST(request:Request){try{const actor=await session(request,true,true);const body=command.parse(await jsonBody(request));
  if(body.action==='save'){const s=settingsSchema.parse(body.settings);validUrl(s.baseUrl,s.localModel);const settings=await (await modelVault()).save(s,body.apiKey,body.minimaxKey,body.revision);await auditConfiguration('provider.configure',actor.id,'管理员更新模型配置，验证已失效');return Response.json({settings,message:'模型配置已保存，请测试连接'});}
  if(body.action==='verify')return Response.json({...await verifyConfiguredModel(),message:'模型调用及结构化输出已验证'});
}catch(e){if(e instanceof z.ZodError)return Response.json({message:'管理操作参数无效'},{status:400});return failure(e);}}
