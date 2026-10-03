import {session} from '../../../../lib/platform';
import { z } from 'zod';
import { safeSettings,settingsSchema } from '@agentsale/automation';
import { validUrl } from '../../../../../packages/automation/src/network';
import { listMiniMaxVoices } from '../../../../../packages/automation/src/voice-catalog';
import { generateSpeech } from '../../../../../packages/automation/src/model-gateway';
import {failure,modelVault,verifyConfiguredModel,auditConfiguration} from '../../../../lib/local-runtime';
import {busyResponse,concurrencyGate} from '../../../../lib/concurrency';
import { jsonBody } from '../../../../lib/server-access';
export const runtime='nodejs';export const dynamic='force-dynamic';
const command=z.discriminatedUnion('action',[
  z.object({action:z.literal('save'),revision:z.string().min(1),settings:z.unknown(),apiKey:z.string().max(4000).optional(),minimaxKey:z.string().max(4000).optional(),aggregateKey:z.string().max(4000).optional()}).strict(),
  z.object({action:z.literal('verify'),providerId:z.enum(['standard','minimax']).optional()}).strict(),
  z.object({action:z.literal('listVoices'),providerId:z.enum(['standard','minimax'])}).strict(),
  z.object({action:z.literal('testSpeech'),providerId:z.enum(['standard','minimax']),voiceId:z.string().trim().min(1).max(100),text:z.string().trim().min(1).max(200)}).strict()
]);
export async function GET(request:Request){try{await session(request,false,true);return Response.json({settings:safeSettings(await (await modelVault()).get())},{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
export async function POST(request:Request){try{const actor=await session(request,true,true);const body=command.parse(await jsonBody(request));
  if(body.action==='save'){const s=settingsSchema.parse(body.settings);validUrl(s.baseUrl,s.localModel);const settings=await (await modelVault()).save(s,body.apiKey,body.minimaxKey,body.aggregateKey,body.revision);await auditConfiguration('provider.configure',actor.id,'管理员更新模型配置，验证已失效');return Response.json({settings,message:'模型配置已保存，请测试连接'});}
  if(body.action==='verify')return Response.json({...await verifyConfiguredModel(body.providerId),message:'模型调用及结构化输出已验证'});
  if(body.action==='listVoices')return Response.json({voices:await listMiniMaxVoices(await (await modelVault()).get(),body.providerId)},{headers:{'Cache-Control':'no-store'}});
  if(body.action==='testSpeech'){
    const release=concurrencyGate.tryAcquire('audio',actor.id);
    if(!release)return busyResponse();
    try{
      const output=await generateSpeech(await (await modelVault()).get(),body.text,body.voiceId,body.providerId);
      return new Response(new Uint8Array(output.bytes),{headers:{'Content-Type':output.mime,'Cache-Control':'no-store'}});
    }finally{release();}
  }
}catch(e){if(e instanceof z.ZodError)return Response.json({message:'管理操作参数无效'},{status:400});return failure(e);}}
