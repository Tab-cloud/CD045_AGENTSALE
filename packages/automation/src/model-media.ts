import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {requestBytes,validUrl} from './network';
import {FlowError,minimaxVideoModelSchema,providerRejectedBeforeExecution} from './types';
import {DomainError} from '@agentsale/domain';

export const modelMediaSchema=z.object({
  image:z.object({enabled:z.boolean(),referenceEditing:z.boolean(),baseUrl:z.string().url().max(500),model:z.string().trim().min(1).max(150)}).strict(),
  video:z.object({enabled:z.boolean(),baseUrl:z.enum(['https://api.minimax.cn/v1','https://api.minimaxi.com/v1','https://api.minimax.io/v1']),model:minimaxVideoModelSchema}).strict(),
}).strict();
export type ModelMediaConfig=z.infer<typeof modelMediaSchema>;
const defaults:ModelMediaConfig={image:{enabled:false,referenceEditing:false,baseUrl:'https://api.openai.com/v1',model:'gpt-image-1'},video:{enabled:false,baseUrl:'https://api.minimax.cn/v1',model:'MiniMax-Hailuo-2.3'}};
type Secrets={config:ModelMediaConfig;imageKey:string;videoKey:string;revision:string};
export type MiniMaxConnection={baseUrl:string;key:string;imageModel:string;videoModel:string};
const withoutFixedMediaParameters=(raw:any)=>({image:{enabled:raw.image.enabled,referenceEditing:raw.image.referenceEditing,baseUrl:raw.image.baseUrl,model:raw.image.model},video:{enabled:raw.video.enabled,baseUrl:raw.video.baseUrl,model:raw.video.model}});
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const numericId=z.string().regex(/^\d{1,64}$/);

export function createModelMedia(root:string,transport:typeof requestBytes=requestBytes){
  const directory=path.join(root,'model-media');
  let writes:Promise<unknown>=Promise.resolve();
  async function encryptionKey(folder=directory){
    await mkdir(folder,{recursive:true,mode:0o700});const file=path.join(folder,'credentials.key');
    try{return await readFile(file);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    try{await writeFile(file,randomBytes(32),{mode:0o600,flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    return readFile(file);
  }
  async function unseal(folder:string){
    const bytes=await readFile(path.join(folder,'credentials.sealed'));
    const cipher=createDecipheriv('aes-256-gcm',await encryptionKey(folder),bytes.subarray(0,12));
    cipher.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString()) as Record<string,unknown>;
  }
  async function save(value:Secrets){
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',await encryptionKey(),iv);
    const encrypted=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
    const sealed=Buffer.concat([iv,cipher.getAuthTag(),encrypted]);
    const file=path.join(directory,'credentials.sealed'),temporary=file+'.'+randomUUID();
    await writeFile(temporary,sealed,{mode:0o600});await rename(temporary,file);
  }
  async function secrets():Promise<Secrets>{
    try{const value=await unseal(directory);const normalized:Secrets={config:modelMediaSchema.parse(withoutFixedMediaParameters(value.config)),imageKey:String(value.imageKey||''),videoKey:String(value.videoKey||''),revision:String(value.revision||'unconfigured')};
      if(JSON.stringify(normalized.config)!==JSON.stringify(value.config))await save(normalized);
      return normalized;}
    catch(error){
      if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new FlowError('MODEL_MEDIA_VAULT','图片和视频模型配置无法读取');
      // One-time data migration. Model requests never fall back to the old business service.
      try{const old=await unseal(path.join(root,'creative'));const legacy=old.config as Record<string,unknown>;
        const migrated:Secrets={config:modelMediaSchema.parse(withoutFixedMediaParameters(legacy)),imageKey:String(old.imageKey||''),videoKey:String(old.videoKey||''),revision:randomUUID()};
        await save(migrated);return migrated;
      }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new FlowError('MODEL_MEDIA_VAULT','旧模型密钥无法迁移，请检查服务端配置');}
      return {config:structuredClone(defaults),imageKey:'',videoKey:'',revision:'unconfigured'};
    }
  }
  const publicConfig=(value:Secrets)=>({...value.config,hasImageKey:!!value.imageKey,hasVideoKey:!!value.videoKey,revision:value.revision});
  async function configuration(){return publicConfig(await secrets());}
  async function configure(raw:unknown,imageKey?:string,videoKey?:string,revision?:string){
    const operation=writes.then(async()=>{
      const config=modelMediaSchema.parse(raw),url=validUrl(config.image.baseUrl);
      if(url.protocol!=='https:'||url.search)throw new FlowError('MODEL_MEDIA_ENDPOINT','图片模型需要无查询参数的 HTTPS 接口');
      for(const key of [imageKey,videoKey])if(key!==undefined&&(key.length>4000||/[\r\n]/.test(key)))throw new FlowError('MODEL_MEDIA_KEY','模型密钥格式无效');
      const old=await secrets();
      if(revision!==old.revision)throw new DomainError('CONFIG_CHANGED','模型配置已被其他管理员修改，请刷新后重试',409);
      const next:Secrets={config,imageKey:imageKey?.trim()??(old.config.image.baseUrl===config.image.baseUrl?old.imageKey:''),videoKey:videoKey?.trim()??(old.config.video.baseUrl===config.video.baseUrl?old.videoKey:''),revision:randomUUID()};
      if(config.image.enabled&&!next.imageKey||config.video.enabled&&!next.videoKey)throw new FlowError('MODEL_MEDIA_KEY','启用模型前请填写对应密钥');
      await save(next);return publicConfig(next);
    });writes=operation.catch(()=>undefined);return operation;
  }
  async function api(value:Secrets,kind:'image'|'video',route:string,body?:unknown,aggregate?:MiniMaxConnection,version:'v1'|'v2'='v1'){
    const config=value.config[kind],key=aggregate?.key||(kind==='image'?value.imageKey:value.videoKey);
    const base=(aggregate?.baseUrl||config.baseUrl).replace(/\/$/,'').replace(/\/v1$/,version==='v2'?'/v2':'/v1');
    const response=await transport(base+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),trustedMiniMax:kind==='video'||!!aggregate,maxBytes:30_000_000,timeout:180000});
    if(response.status!==200)throw new FlowError(providerRejectedBeforeExecution(response.status)?'PROVIDER_UNAVAILABLE':'MODEL_MEDIA_HTTP',`模型服务返回 HTTP ${response.status}`,response.status>=500&&!providerRejectedBeforeExecution(response.status));
    if(kind==='image'){
      if(aggregate){let data:any;try{data=JSON.parse(response.body.toString());}catch{throw new FlowError('MODEL_MEDIA_RESPONSE','图片模型响应格式无效');}
        if(data.base_resp?.status_code!==0||!Array.isArray(data.data?.image_urls)||!data.data.image_urls.length)throw new FlowError('MODEL_MEDIA_RESPONSE','图片模型未完成生成');}
      return {data:null as any,bytes:response.body};
    }
    let data:any;try{data=JSON.parse(response.body.toString());}catch{throw new FlowError('MODEL_MEDIA_RESPONSE','模型服务响应格式无效');}
    if(data.base_resp&&data.base_resp.status_code!==0)throw new FlowError('MODEL_MEDIA_RESPONSE','视频模型未接受任务');
    return {data,bytes:response.body};
  }
  async function imageEdit(value:Secrets,prompt:string,bytes:Buffer,mime:'image/png'|'image/jpeg'|'image/webp',parameters:Record<string,string|number|boolean>){
    const form=new FormData();for(const [name,entry] of Object.entries(parameters))form.set(name,String(entry));
    form.set('model',value.config.image.model);form.set('prompt',prompt);form.set('n','1');
    form.set('image',new Blob([new Uint8Array(bytes)],{type:mime}),'reference.'+({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mime]));
    const encoded=new Response(form);
    const response=await transport(value.config.image.baseUrl.replace(/\/$/,'')+'/images/edits',{method:'POST',headers:{Authorization:'Bearer '+value.imageKey,'Content-Type':encoded.headers.get('content-type')!},body:Buffer.from(await encoded.arrayBuffer()),maxBytes:30_000_000,timeout:180000});
    if(response.status!==200)throw new FlowError(providerRejectedBeforeExecution(response.status)?'PROVIDER_UNAVAILABLE':'MODEL_MEDIA_HTTP',`图片编辑模型返回 HTTP ${response.status}`,response.status>=500&&!providerRejectedBeforeExecution(response.status));
    return response.body;
  }
  async function modelImage(prompt:string,reference?:{bytes:Buffer;mime:'image/png'|'image/jpeg'|'image/webp'},parameters:Record<string,string|number|boolean>={},aggregate?:MiniMaxConnection){
    const value=await secrets();if(aggregate?!!reference:!value.config.image.enabled||!value.imageKey||reference&&!value.config.image.referenceEditing)throw new FlowError('PROVIDER_UNAVAILABLE','图片模型未配置或未启用');
    if(reference){
      if(!reference.bytes.length||reference.bytes.length>4_000_000)throw new FlowError('MODEL_MEDIA_REFERENCE','参考图大小无效');
      return {bytes:await imageEdit(value,prompt,reference.bytes,reference.mime,parameters),mime:'application/json' as const,model:value.config.image.model};
    }
    const result=await api(value,'image',aggregate?'/image_generation':'/images/generations',{...parameters,model:aggregate?.imageModel||value.config.image.model,prompt,n:1,...(aggregate?{response_format:'url'}:{})},aggregate);
    return {bytes:result.bytes,mime:'application/json' as const,model:aggregate?.imageModel||value.config.image.model};
  }
  async function modelVideoSubmit(prompt:string,parameters:Record<string,string|number|boolean>={},aggregate?:MiniMaxConnection){
    const value=await secrets();if(!aggregate&&(!value.config.video.enabled||!value.videoKey))throw new FlowError('PROVIDER_UNAVAILABLE','视频模型未配置或未启用');
    const model=aggregate?.videoModel||value.config.video.model,v2=['MiniMax-H3','MiniMax-H3-Max'].includes(model);
    const result=await api(value,'video','/video_generation',v2?{...parameters,model,content:[{type:'text',text:prompt}]}:{...parameters,model,prompt},aggregate,v2?'v2':'v1');
    return {taskId:numericId.parse(result.data.task_id),fingerprint:digest(JSON.stringify(aggregate||value.config.video)+(aggregate?.key||value.videoKey)),model:aggregate?.videoModel||value.config.video.model};
  }
  async function modelVideoPoll(taskId:string,fingerprint:string,aggregate?:MiniMaxConnection):Promise<{status:'processing'|'completed'|'failed';sourceUrl?:string;model:string}>{
    const value=await secrets();if(digest(JSON.stringify(aggregate||value.config.video)+(aggregate?.key||value.videoKey))!==fingerprint)throw new FlowError('MODEL_MEDIA_CHANGED','视频模型配置已变更，无法安全查询原任务');
    const model=aggregate?.videoModel||value.config.video.model;
    if(['MiniMax-H3','MiniMax-H3-Max'].includes(model)){
      const result=await api(value,'video','/query/video_generation/'+numericId.parse(taskId),undefined,aggregate,'v2');
      const task=result.data.task;
      const returnedId=task?.task_id??task?.id??result.data.task_id;
      if(!task||returnedId!==undefined&&String(returnedId)!==taskId)throw new FlowError('MODEL_MEDIA_RESPONSE','视频任务号不匹配');
      if(task.status==='failed'||task.status==='cancelled')return {status:'failed',model};
      if(task.status!=='succeeded')return {status:'processing',model};
      const sourceUrl=task.content?.url;
      if(typeof sourceUrl!=='string'||!sourceUrl.startsWith('https://'))throw new FlowError('MODEL_MEDIA_RESPONSE','视频文件地址无效');
      return {status:'completed',sourceUrl,model};
    }
    const result=await api(value,'video','/query/video_generation?task_id='+numericId.parse(taskId),undefined,aggregate);
    if(String(result.data.task_id)!==taskId)throw new FlowError('MODEL_MEDIA_RESPONSE','视频任务号不匹配');
    if(['Preparing','Queueing','Processing'].includes(result.data.status))return {status:'processing',model:aggregate?.videoModel||value.config.video.model};
    if(result.data.status!=='Success')return {status:'failed',model:aggregate?.videoModel||value.config.video.model};
    const fileId=numericId.parse(result.data.file_id),file=await api(value,'video','/files/retrieve?file_id='+fileId,undefined,aggregate);
    if(String(file.data.file?.file_id)!==fileId)throw new FlowError('MODEL_MEDIA_RESPONSE','视频文件编号不匹配');
    const sourceUrl=file.data.file?.download_url;
    if(typeof sourceUrl!=='string'||!sourceUrl.startsWith('https://'))throw new FlowError('MODEL_MEDIA_RESPONSE','视频文件地址无效');
    return {status:'completed',sourceUrl,model:aggregate?.videoModel||value.config.video.model};
  }
  return {configuration,configure,modelImage,modelVideoSubmit,modelVideoPoll};
}
