import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {z} from 'zod';
import {modelRequestSchema,modelInputError,generateSpeech} from '../../../../../packages/automation/src/model-gateway';
import {assertProvider} from '../../../../../packages/automation/src/providers';
import {FlowError,minimaxVideoAllowed} from '../../../../../packages/automation/src/types';
import {requestStream} from '../../../../../packages/automation/src/network';
import {modelMediaService} from '../../../../lib/model-media-service';
import {failure,modelVault} from '../../../../lib/local-runtime';
import {readModelFile,streamModelFile,storeModelFile} from '../../../../lib/model-files';
import {busyResponse,concurrencyGate,type Lane} from '../../../../lib/concurrency';
import {session,platform} from '../../../../lib/platform';
import {startModelWorker} from '../../../../lib/model-job-queue';
import {subscribeText} from '../../../../lib/model-text-stream';
import {jsonBody} from '../../../../lib/server-access';
import type {SecretSettings} from '../../../../../packages/automation/src/types';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const aggregate=(settings:SecretSettings)=>settings.minimax.aggregate&&settings.aggregateKey?{baseUrl:settings.minimax.baseUrl,key:settings.aggregateKey,imageModel:settings.minimax.imageModel,videoModel:settings.minimax.videoModel}:undefined;
const videoConnection=(settings:SecretSettings)=>{
  const {planType,videoModel,videoEnabled}=settings.minimax;
  return videoEnabled&&minimaxVideoAllowed(planType,videoModel)?aggregate(settings):undefined;
};

export async function GET(request:Request){
  try{
    const user=await session(request),p=await platform();
    const lookup=new URL(request.url).searchParams.get('lookup');
    if(lookup){
      const id=z.string().uuid().parse(lookup),entry=await p.members.modelRequest(id,user.id);
      return Response.json({id,status:entry.status,capability:entry.capability,result:entry.result},{headers:{'Cache-Control':'no-store'}});
    }
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
            else finish(event.type,event.type==='completed'?{text:event.text}:{code:event.code||'MODEL_REQUEST_UNCERTAIN',message:event.message,safeToFailover:event.safeToFailover});
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
      if(entry.status!=='completed'||!['image.generate','image.edit','video.generate','audio.speech'].includes(entry.capability))return Response.json({code:'MODEL_RESULT_UNAVAILABLE',message:'模型结果尚未生成或已过期'},{status:404});
      const release=concurrencyGate.tryAcquire('asset',user.id);
      if(!release)return busyResponse();
      try{
        if(new URL(request.url).searchParams.get('source')==='1'||entry.capability==='video.generate'){
          let sourceUrl:string|undefined;
          if(entry.capability==='video.generate'){
            sourceUrl=typeof entry.result?.sourceUrl==='string'?entry.result.sourceUrl:undefined;
            if(!sourceUrl){release();return Response.json({code:'MODEL_RESULT_EXPIRED',message:'旧视频缓存请从部署前备份提取'},{status:410});}
          }else if(entry.capability==='image.generate'||entry.capability==='image.edit'){
            const raw=await readModelFile(user.id,asset);
            const data=JSON.parse(raw.toString());
            sourceUrl=data.data?.[0]?.url||data.data?.image_urls?.[0];
          }
          if(typeof sourceUrl!=='string'||!sourceUrl.startsWith('https://'))throw new FlowError('MODEL_RESULT_UNAVAILABLE','供应商未提供下载地址');
          const transfer={maxBytes:entry.capability==='video.generate'?100_000_000:30_000_000,trustedMiniMax:entry.capability==='video.generate'||entry.result?.provider==='minimax'};
          let response=await requestStream(sourceUrl,transfer);
          if(response.status!==200&&entry.capability==='video.generate'&&typeof entry.result?.taskId==='string'&&typeof entry.result?.fingerprint==='string'){
            response.body.destroy();
            const settings=await (await modelVault()).get();
            const refreshed=await (await modelMediaService()).modelVideoPoll(entry.result.taskId,entry.result.fingerprint,entry.result.provider==='minimax'?aggregate(settings):undefined);
            if(refreshed.status==='completed'&&refreshed.sourceUrl)response=await requestStream(refreshed.sourceUrl,transfer);
          }
          if(response.status!==200){response.body.destroy();throw new FlowError('MODEL_RESULT_UNAVAILABLE',`供应商下载返回 HTTP ${response.status}`);}
          response.body.once('close',release);
          return new Response(Readable.toWeb(response.body) as ReadableStream<Uint8Array>,{headers:{'Content-Type':String(response.headers['content-type']||'application/octet-stream'),...(response.headers['content-encoding']?{'Content-Encoding':String(response.headers['content-encoding'])}:{}),'Cache-Control':'no-store, no-transform','X-Content-Type-Options':'nosniff'}});
        }
        const stream=await streamModelFile(user.id,asset,'application/json');
        stream.once('close',release);
        return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>,{headers:{'Content-Type':'application/json','Cache-Control':'no-store, no-transform','X-Content-Type-Options':'nosniff'}});
      }catch(error){
        release();
        if((error as NodeJS.ErrnoException).code==='ENOENT')return Response.json({code:'MODEL_RESULT_EXPIRED',message:'模型原始响应已过期；旧格式缓存请从部署前备份提取'},{status:410});
        return failure(error);
      }
    }
    const [settings,creative,member]=await Promise.all([(await modelVault()).get(),(await modelMediaService()).configuration(),p.members.status(user.id)]);
    const allowed=(feature:'model'|'image'|'video'|'audio')=>member.features.includes(feature);
    const bundled=aggregate(settings),usingBundle=!!bundled;
    const candidate=(id:keyof typeof settings.routing,providerId:'standard'|'minimax',configured:boolean,model:string,feature:'model'|'image'|'video'|'audio')=>({id,providerId,provider:providerId==='minimax'?'minimax':id==='image.generate'||id==='image.edit'?'openai':'standard',model,configured,available:allowed(feature)&&configured,priority:(settings.routing[id] as readonly string[]).indexOf(providerId)+1});
    const capabilities=[
      candidate('text.generate','standard',!!settings.model&&!!(settings.apiKey||settings.localModel),settings.model,'model'),
      candidate('text.generate','minimax',usingBundle,settings.minimax.textModel,'model'),
      candidate('image.generate','standard',creative.image.enabled&&creative.hasImageKey,creative.image.model,'image'),
      candidate('image.generate','minimax',usingBundle,settings.minimax.imageModel,'image'),
      candidate('image.edit','standard',creative.image.enabled&&creative.image.referenceEditing&&creative.hasImageKey,creative.image.model,'image'),
      candidate('video.generate','standard',creative.video.enabled&&creative.hasVideoKey,creative.video.model,'video'),
      candidate('video.generate','minimax',!!videoConnection(settings),settings.minimax.videoModel,'video'),
      candidate('audio.speech','standard',settings.independentAudioEnabled&&!!settings.minimaxKey,settings.minimax.speechModel,'audio'),
      candidate('audio.speech','minimax',usingBundle&&settings.minimax.enabled,settings.minimax.speechModel,'audio'),
    ].sort((a,b)=>a.id.localeCompare(b.id)||a.priority-b.priority);
    return Response.json({version:3,constraints:{maxAssets:4},voices:settings.minimax.voices,capabilities:capabilities.map(item=>item.id==='audio.speech'?{...item,inputLimits:{maxTextCharacters:9999}}:item)},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return failure(error);}
}

export async function POST(request:Request){
  try{
    const user=await session(request,true);
    const releaseInput=concurrencyGate.tryAcquire('modelInput',user.id);
    if(!releaseInput)return busyResponse();
    const body=await (async()=>{try{return modelRequestSchema.parse(await jsonBody(request,5_600_000));}finally{releaseInput();}})();
    const p=await platform();
    if(body.action==='video.poll'){
      const release=concurrencyGate.tryAcquire('videoPoll',user.id,body.id);
      if(!release)return busyResponse();
      try{
      const existing=await p.members.modelRequest(body.id,user.id);
      if(existing.capability!=='video.generate')return Response.json({code:'MODEL_REQUEST_CONFLICT',message:'模型请求能力不匹配'},{status:409});
      if(existing.status==='completed'||existing.status==='failed')return Response.json({id:body.id,status:existing.status,message:existing.status==='completed'?'视频已生成，可保存到桌面':'视频模型生成失败',taskId:'model-gateway-v1',...(existing.status==='completed'?{mime:existing.result?.mime,model:existing.result?.model}:{})},{headers:{'Cache-Control':'no-store'}});
      if(existing.status!=='processing'||typeof existing.result?.taskId!=='string'||typeof existing.result?.fingerprint!=='string')return Response.json({code:'MODEL_REQUEST_UNCERTAIN',message:'视频提交结果未知，不会重复提交'},{status:409});
      const settings=await (await modelVault()).get();
      const result=await (await modelMediaService()).modelVideoPoll(existing.result.taskId,existing.result.fingerprint,existing.result.provider==='minimax'?aggregate(settings):undefined);
      if(result.status==='processing')return Response.json({id:body.id,status:'processing',message:'视频模型正在生成',taskId:'model-gateway-v1'},{headers:{'Cache-Control':'no-store'}});
      if(result.status==='failed'){await p.members.finishModelRequest(body.id,user.id,{model:result.model},'failed');return Response.json({id:body.id,status:'failed',message:'视频模型生成失败',taskId:'model-gateway-v1'},{headers:{'Cache-Control':'no-store'}});}
      await p.members.finishModelRequest(body.id,user.id,{id:body.id,status:'completed',message:'视频已生成，可保存到桌面',taskId:existing.result.taskId,fingerprint:existing.result.fingerprint,sourceUrl:result.sourceUrl,model:result.model,provider:existing.result.provider},'completed');
      return Response.json({id:body.id,status:'completed',message:'视频已生成，可保存到桌面',taskId:'model-gateway-v1',model:result.model},{headers:{'Cache-Control':'no-store'}});
      }finally{release();}
    }
    const config=await (await modelVault()).get();
    if(body.action==='text.generate'&&body.providerId==='standard'){
      try{assertProvider(config,false);}catch(error){if(FlowError.is(error)&&error.code==='MODEL_UNCONFIGURED')throw new FlowError('PROVIDER_UNAVAILABLE','普通文本连接未配置');throw error;}
    }
    if(body.action==='text.generate'&&body.providerId==='minimax'&&!aggregate(config))throw new FlowError('PROVIDER_UNAVAILABLE','MiniMax 聚合文本连接未启用');
    if(body.action==='audio.speech'&&!(body.providerId==='minimax'?!!aggregate(config)&&config.minimax.enabled:config.independentAudioEnabled&&!!config.minimaxKey))throw new FlowError('PROVIDER_UNAVAILABLE','音频模型未配置或未启用');
    if(body.action==='audio.speech'&&!config.minimax.voices.some(voice=>voice.id===body.voiceId))throw new FlowError('AUDIO_VOICE','所选音色不在管理员开放列表中');
    if(body.action==='image.edit'&&(!/^[A-Za-z0-9+/]+={0,2}$/.test(body.reference!)||Buffer.from(body.reference!,'base64').length>4_000_000))throw new FlowError('CREATIVE_REFERENCE','参考图格式或大小无效');
    if(body.action==='image.generate'||body.action==='image.edit'||body.action==='video.generate'){
      const provider=await (await modelMediaService()).configuration();
      const selected=body.providerId==='minimax';
      if((body.action==='image.edit'&&selected)||(body.action==='video.generate'&&(selected?!videoConnection(config):!provider.video.enabled||!provider.hasVideoKey))||(body.action==='image.generate'&&(selected?!aggregate(config):!provider.image.enabled||!provider.hasImageKey))||(body.action==='image.edit'&&(!provider.image.enabled||!provider.hasImageKey||!provider.image.referenceEditing)))throw new FlowError('PROVIDER_UNAVAILABLE','所选模型连接未配置或未启用');
    }
    const lane:Lane=body.action==='text.generate'?'text':body.action==='video.generate'?'videoSubmit':body.action==='audio.speech'?'audio':'image';
    const release=concurrencyGate.tryAcquire(lane,user.id);
    if(!release)return busyResponse();
    try{
    const hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const blob=body.action==='text.generate'?await (await modelVault()).sealText(JSON.stringify(body)):undefined;
    const claim=await p.members.claimModelRequest(body.id,user.id,hash,body.action,blob);
    if(!claim.created){
      if(claim.status==='completed'&&claim.result)return Response.json(body.action==='video.generate'?{id:body.id,status:'completed',message:'视频已生成，可保存到桌面',taskId:'model-gateway-v1',model:claim.result.model}:claim.result,{headers:{'Cache-Control':'no-store'}});
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
        const result=await (await modelMediaService()).modelVideoSubmit(body.prompt,body.parameters,body.providerId==='minimax'?videoConnection(config):undefined);
        await p.members.finishModelRequest(body.id,user.id,{...result,provider:body.providerId},'processing');
        return Response.json({id:body.id,status:'processing',message:'视频模型正在生成',taskId:'model-gateway-v1'},{headers:{'Cache-Control':'no-store'}});
      }
      const output=body.action==='audio.speech'?await generateSpeech(config,body.text,body.voiceId,body.providerId,body.parameters):await (await modelMediaService()).modelImage(body.prompt,body.action==='image.edit'?{bytes:Buffer.from(body.reference!,'base64'),mime:body.referenceMime!}:undefined,body.parameters,body.providerId==='minimax'?aggregate(config):undefined);
      await storeModelFile(user.id,body.id,'application/json',output.bytes);
      const result={id:body.id,status:'completed',message:'供应商原始响应已就绪',taskId:'model-gateway-v1',mime:'application/json',model:output.model,provider:body.providerId};
      await p.members.finishModelRequest(body.id,user.id,result);
      return Response.json(result,{headers:{'Cache-Control':'no-store'}});
    }catch(error){
      const unavailable=FlowError.is(error)&&error.code==='PROVIDER_UNAVAILABLE';
      await p.members.finishModelRequest(body.id,user.id,{code:unavailable?'PROVIDER_UNAVAILABLE':'MODEL_REQUEST_UNCERTAIN',safeToFailover:unavailable,message:unavailable?'当前模型连接明确未受理请求，可尝试下一供应商':'模型提交结果无法确认，不会自动切换供应商'},unavailable?'failed':'unknown');
      if(unavailable)return Response.json({code:'PROVIDER_UNAVAILABLE',safeToFailover:true,message:'当前模型连接明确未受理请求，可尝试下一供应商'},{status:503});
      throw error;
    }
    }finally{release();}
  }catch(error){
    if(error instanceof z.ZodError)return Response.json(modelInputError(error),{status:400});
    return failure(error);
  }
}
