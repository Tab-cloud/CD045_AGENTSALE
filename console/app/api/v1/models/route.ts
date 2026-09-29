import {createHash} from 'node:crypto';
import {z} from 'zod';
import {textGenerationSchema,imageGenerationSchema,videoGenerationSchema,videoPollSchema,audioSpeechSchema,generateText,generateSpeech} from '../../../../../packages/automation/src/model-gateway';
import {assertProvider} from '../../../../../packages/automation/src/providers';
import {FlowError} from '../../../../../packages/automation/src/types';
import {modelMediaService} from '../../../../lib/model-media-service';
import {failure,modelVault} from '../../../../lib/local-runtime';
import {readModelFile,storeModelFile} from '../../../../lib/model-files';
import {session,platform} from '../../../../lib/platform';
import {jsonBody} from '../../../../lib/server-access';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request){
  try{
    const user=await session(request),p=await platform();
    const asset=new URL(request.url).searchParams.get('asset');
    if(asset){
      const entry=await p.members.modelRequest(z.string().uuid().parse(asset),user.id);
      if(entry.status!=='completed'||!['image/png','video/mp4','audio/mpeg'].includes(String(entry.result?.mime)))return Response.json({code:'MODEL_RESULT_UNAVAILABLE',message:'模型结果尚未生成或已过期'},{status:404});
      const mime=entry.result!.mime as 'image/png'|'video/mp4'|'audio/mpeg';
      try{return new Response(new Uint8Array(await readModelFile(user.id,asset,mime)),{headers:{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
      catch{return Response.json({code:'MODEL_RESULT_EXPIRED',message:'模型结果临时文件已过期'},{status:410});}
    }
    const [settings,creative,member]=await Promise.all([(await modelVault()).get(),(await modelMediaService()).configuration(),p.members.status(user.id)]);
    const allowed=(feature:'model'|'image'|'video'|'audio')=>member.features.includes(feature);
    return Response.json({version:1,constraints:{imageSize:creative.image.size,videoSeconds:creative.video.duration,maxAssets:4},capabilities:[
      {id:'text.generate',model:settings.model,configured:!!settings.model&&!!(settings.apiKey||settings.localModel),available:allowed('model')&&!!settings.model&&!!(settings.apiKey||settings.localModel)},
      {id:'image.generate',model:creative.image.model,configured:creative.image.enabled&&creative.hasImageKey,available:allowed('image')&&creative.image.enabled&&creative.hasImageKey},
      {id:'image.edit',model:creative.image.model,configured:creative.image.enabled&&creative.image.referenceEditing&&creative.hasImageKey,available:allowed('image')&&creative.image.enabled&&creative.image.referenceEditing&&creative.hasImageKey},
      {id:'video.generate',model:creative.video.model,configured:creative.video.enabled&&creative.hasVideoKey,available:allowed('video')&&creative.video.enabled&&creative.hasVideoKey},
      {id:'audio.speech',model:settings.minimax.speechModel,configured:!!settings.minimaxKey&&settings.minimax.enabled,available:allowed('audio')&&!!settings.minimaxKey&&settings.minimax.enabled},
    ]},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return failure(error);}
}

export async function POST(request:Request){
  try{
    const user=await session(request,true),body=z.union([textGenerationSchema,imageGenerationSchema,videoGenerationSchema,videoPollSchema,audioSpeechSchema]).parse(await jsonBody(request,5_600_000)),p=await platform();
    if(body.action==='video.poll'){
      const existing=await p.members.modelRequest(body.id,user.id);
      if(existing.capability!=='video.generate')return Response.json({code:'MODEL_REQUEST_CONFLICT',message:'模型请求能力不匹配'},{status:409});
      if(existing.status==='completed'||existing.status==='failed')return Response.json({id:body.id,status:existing.status,message:existing.status==='completed'?'视频已生成，可保存到桌面':'视频模型生成失败',taskId:'model-gateway-v1',...(existing.status==='completed'?{mime:existing.result?.mime,model:existing.result?.model}:{})},{headers:{'Cache-Control':'no-store'}});
      if(existing.status!=='processing'||typeof existing.result?.taskId!=='string'||typeof existing.result?.fingerprint!=='string')return Response.json({code:'MODEL_REQUEST_UNCERTAIN',message:'视频提交结果未知，不会重复提交'},{status:409});
      const result=await (await modelMediaService()).modelVideoPoll(existing.result.taskId,existing.result.fingerprint);
      if(result.status==='processing')return Response.json({id:body.id,status:'processing',message:'视频模型正在生成',taskId:'model-gateway-v1'},{headers:{'Cache-Control':'no-store'}});
      if(result.status==='failed'){await p.members.finishModelRequest(body.id,user.id,{model:result.model},'failed');return Response.json({id:body.id,status:'failed',message:'视频模型生成失败',taskId:'model-gateway-v1'},{headers:{'Cache-Control':'no-store'}});}
      await storeModelFile(user.id,body.id,'video/mp4',result.bytes!);
      await p.members.finishModelRequest(body.id,user.id,{id:body.id,status:'completed',message:'视频已生成，可保存到桌面',taskId:'model-gateway-v1',mime:'video/mp4',model:result.model},'completed');
      return Response.json({id:body.id,status:'completed',message:'视频已生成，可保存到桌面',taskId:'model-gateway-v1',mime:'video/mp4',model:result.model},{headers:{'Cache-Control':'no-store'}});
    }
    const config=await (await modelVault()).get();
    if(body.action==='text.generate')assertProvider(config,false);
    if(body.action==='audio.speech'&&(!config.minimaxKey||!config.minimax.enabled))throw new FlowError('AUDIO_UNCONFIGURED','音频模型未配置或未启用');
    if(body.action==='image.edit'&&(!/^[A-Za-z0-9+/]+={0,2}$/.test(body.reference!)||Buffer.from(body.reference!,'base64').length>4_000_000))throw new FlowError('CREATIVE_REFERENCE','参考图格式或大小无效');
    if(body.action==='image.generate'||body.action==='image.edit'||body.action==='video.generate'){
      const provider=await (await modelMediaService()).configuration();
      if(body.action==='video.generate'?!provider.video.enabled||!provider.hasVideoKey:!provider.image.enabled||!provider.hasImageKey||body.action==='image.edit'&&!provider.image.referenceEditing)throw new FlowError('CREATIVE_UNCONFIGURED','对应模型未配置或未启用');
    }
    const hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const claim=await p.members.claimModelRequest(body.id,user.id,hash,body.action);
    if(!claim.created){
      if(claim.status==='completed'&&claim.result)return Response.json(claim.result,{headers:{'Cache-Control':'no-store'}});
      if(claim.status==='processing'&&body.action==='video.generate')return Response.json({id:body.id,status:'processing',message:'视频模型正在生成',taskId:'model-gateway-v1'},{headers:{'Cache-Control':'no-store'}});
      return Response.json({code:claim.status==='completed'?'MODEL_RESULT_EXPIRED':'MODEL_REQUEST_UNCERTAIN',message:claim.status==='completed'?'历史模型响应已过保留期，请创建新任务':'原模型请求仍在处理或结果未知，不会重复计费提交'},{status:409});
    }
    try{
      if(body.action==='text.generate'){
        const result=await generateText(config,body);
        await p.members.finishModelRequest(body.id,user.id,result);
        return Response.json(result,{headers:{'Cache-Control':'no-store'}});
      }
      if(body.action==='video.generate'){
        const result=await (await modelMediaService()).modelVideoSubmit(body.prompt);
        await p.members.finishModelRequest(body.id,user.id,result,'processing');
        return Response.json({id:body.id,status:'processing',message:'视频模型正在生成',taskId:'model-gateway-v1'},{headers:{'Cache-Control':'no-store'}});
      }
      const output=body.action==='audio.speech'?await generateSpeech(config,body.text):await (await modelMediaService()).modelImage(body.prompt,body.action==='image.edit'?Buffer.from(body.reference!,'base64'):undefined);
      const mime=output.mime as 'image/png'|'audio/mpeg';
      await storeModelFile(user.id,body.id,mime,output.bytes);
      const result={id:body.id,status:'completed',message:'模型结果已生成，可保存到桌面',taskId:'model-gateway-v1',mime,model:output.model};
      await p.members.finishModelRequest(body.id,user.id,result);
      return Response.json(result,{headers:{'Cache-Control':'no-store'}});
    }catch(error){
      await p.members.finishModelRequest(body.id,user.id,null);
      throw error;
    }
  }catch(error){
    if(error instanceof z.ZodError)return Response.json({code:'MODEL_INPUT',message:'模型请求格式无效'},{status:400});
    return failure(error);
  }
}
