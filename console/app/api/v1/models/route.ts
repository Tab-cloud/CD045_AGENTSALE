import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {z} from 'zod';
import {textGenerationSchema,imageGenerationSchema,videoGenerationSchema,videoPollSchema,audioSpeechSchema,generateSpeech} from '../../../../../packages/automation/src/model-gateway';
import {assertProvider} from '../../../../../packages/automation/src/providers';
import {FlowError} from '../../../../../packages/automation/src/types';
import {modelMediaService} from '../../../../lib/model-media-service';
import {failure,modelVault} from '../../../../lib/local-runtime';
import {streamModelFile,storeModelFile} from '../../../../lib/model-files';
import {busyResponse,concurrencyGate,type Lane} from '../../../../lib/concurrency';
import {session,platform} from '../../../../lib/platform';
import {startModelWorker} from '../../../../lib/model-job-queue';
import {subscribeText} from '../../../../lib/model-text-stream';
import {jsonBody} from '../../../../lib/server-access';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request){
  try{
    const user=await session(request),p=await platform();
    const requestId=new URL(request.url).searchParams.get('request');
    if(requestId){
      const id=z.string().uuid().parse(requestId),entry=await p.members.modelRequest(id,user.id);
      if(entry.capability!=='text.generate')return Response.json({code:'MODEL_REQUEST_CONFLICT',message:'模型请求能力不匹配'},{status:409});
      const release=concurrencyGate.tryAcquire('textStream',user.id);
      if(!release)return busyResponse();
      startModelWorker();
      const encoder=new TextEncoder();
      let closed=false,unsubscribe=()=>{},heartbeat:ReturnType<typeof setInterval>|undefined;
      const cleanup=()=>{if(closed)return;closed=true;if(heartbeat)clearInterval(heartbeat);unsubscribe();release();};
      const stream=new ReadableStream<Uint8Array>({
        start(controller){
          const send=(event:string,value:unknown)=>{if(!closed)controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));};
          const finish=(event:string,value:unknown)=>{if(closed)return;send(event,value);cleanup();controller.close();};
          const inspect=async(current:typeof entry)=>{
            if(closed)return;
            if(current.status==='completed')return current.result?.text?finish('completed',current.result):finish('failed',{code:'MODEL_RESULT_EXPIRED',message:'历史模型响应已过保留期'});
            if(current.status==='failed'||current.status==='unknown')return finish('failed',current.result||{code:'MODEL_REQUEST_UNCERTAIN',message:'模型请求结果无法确认'});
          };
          unsubscribe=subscribeText(id,event=>{
            if(event.type==='snapshot'||event.type==='delta')send(event.type,{text:event.text});
            else finish(event.type,event.type==='completed'?{text:event.text}:{code:'MODEL_REQUEST_UNCERTAIN',message:event.message});
          });
          heartbeat=setInterval(()=>{
            if(closed)return;
            controller.enqueue(encoder.encode(': keepalive\n\n'));
            void p.members.modelRequest(id,user.id).then(inspect).catch(()=>finish('failed',{code:'MODEL_STREAM_ERROR',message:'无法查询模型任务状态'}));
          },15_000);
          send('status',{id,status:'processing'});
          void inspect(entry).then(()=>closed?undefined:p.members.modelRequest(id,user.id).then(inspect)).catch(()=>finish('failed',{code:'MODEL_STREAM_ERROR',message:'无法查询模型任务状态'}));
        },
        cancel(){cleanup();}
      });
      return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'}});
    }
    const asset=new URL(request.url).searchParams.get('asset');
    if(asset){
      const entry=await p.members.modelRequest(z.string().uuid().parse(asset),user.id);
      if(entry.status!=='completed'||!['image/png','video/mp4','audio/mpeg'].includes(String(entry.result?.mime)))return Response.json({code:'MODEL_RESULT_UNAVAILABLE',message:'模型结果尚未生成或已过期'},{status:404});
      const mime=entry.result!.mime as 'image/png'|'video/mp4'|'audio/mpeg';
      const release=concurrencyGate.tryAcquire('asset',user.id);
      if(!release)return busyResponse();
      try{
        const stream=await streamModelFile(user.id,asset,mime);
        stream.once('close',release);
        return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>,{headers:{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
      }catch{release();return Response.json({code:'MODEL_RESULT_EXPIRED',message:'模型结果临时文件已过期'},{status:410});}
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
    const user=await session(request,true);
    const releaseInput=concurrencyGate.tryAcquire('modelInput',user.id);
    if(!releaseInput)return busyResponse();
    const body=await (async()=>{try{return z.union([textGenerationSchema,imageGenerationSchema,videoGenerationSchema,videoPollSchema,audioSpeechSchema]).parse(await jsonBody(request,5_600_000));}finally{releaseInput();}})();
    const p=await platform();
    if(body.action==='video.poll'){
      const release=concurrencyGate.tryAcquire('videoPoll',user.id,body.id);
      if(!release)return busyResponse();
      try{
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
      }finally{release();}
    }
    const config=await (await modelVault()).get();
    if(body.action==='text.generate')assertProvider(config,false);
    if(body.action==='audio.speech'&&(!config.minimaxKey||!config.minimax.enabled))throw new FlowError('AUDIO_UNCONFIGURED','音频模型未配置或未启用');
    if(body.action==='image.edit'&&(!/^[A-Za-z0-9+/]+={0,2}$/.test(body.reference!)||Buffer.from(body.reference!,'base64').length>4_000_000))throw new FlowError('CREATIVE_REFERENCE','参考图格式或大小无效');
    if(body.action==='image.generate'||body.action==='image.edit'||body.action==='video.generate'){
      const provider=await (await modelMediaService()).configuration();
      if(body.action==='video.generate'?!provider.video.enabled||!provider.hasVideoKey:!provider.image.enabled||!provider.hasImageKey||body.action==='image.edit'&&!provider.image.referenceEditing)throw new FlowError('CREATIVE_UNCONFIGURED','对应模型未配置或未启用');
    }
    const lane:Lane=body.action==='text.generate'?'text':body.action==='video.generate'?'videoSubmit':body.action==='audio.speech'?'audio':'image';
    const release=concurrencyGate.tryAcquire(lane,user.id);
    if(!release)return busyResponse();
    try{
    const hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const blob=body.action==='text.generate'?await (await modelVault()).sealText(JSON.stringify(body)):undefined;
    const claim=await p.members.claimModelRequest(body.id,user.id,hash,body.action,blob);
    if(!claim.created){
      if(claim.status==='completed'&&claim.result)return Response.json(claim.result,{headers:{'Cache-Control':'no-store'}});
      if(claim.status==='failed')return Response.json(claim.result||{code:'MODEL_REQUEST_FAILED',message:'模型请求失败'},{status:422});
      if(body.action==='text.generate'&&['queued','submitting','processing'].includes(claim.status))return Response.json({id:body.id,status:'processing'},{headers:{'Cache-Control':'no-store'}});
      if(claim.status==='processing'&&body.action==='video.generate')return Response.json({id:body.id,status:'processing',message:'视频模型正在生成',taskId:'model-gateway-v1'},{headers:{'Cache-Control':'no-store'}});
      return Response.json({code:claim.status==='completed'?'MODEL_RESULT_EXPIRED':'MODEL_REQUEST_UNCERTAIN',message:claim.status==='completed'?'历史模型响应已过保留期，请创建新任务':'原模型请求仍在处理或结果未知，不会重复计费提交'},{status:409});
    }
    try{
      if(body.action==='text.generate'){
        startModelWorker();
        return Response.json({id:body.id,status:'processing'},{headers:{'Cache-Control':'no-store'}});
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
    }finally{release();}
  }catch(error){
    if(error instanceof z.ZodError)return Response.json({code:'MODEL_INPUT',message:'模型请求格式无效'},{status:400});
    return failure(error);
  }
}
