import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {z} from 'zod';
import {requestBytes,validUrl} from './network';
import {FlowError} from './types';
import {DomainError} from '@agentsale/domain';

export const modelMediaSchema=z.object({
  image:z.object({enabled:z.boolean(),referenceEditing:z.boolean(),baseUrl:z.string().url().max(500),model:z.string().trim().min(1).max(150),size:z.enum(['1024x1024','1536x1024','1024x1536','auto'])}).strict(),
  video:z.object({enabled:z.boolean(),baseUrl:z.enum(['https://api.minimax.cn/v1','https://api.minimaxi.com/v1','https://api.minimax.io/v1']),model:z.enum(['MiniMax-Hailuo-2.3','MiniMax-Hailuo-02']),duration:z.literal(6),resolution:z.literal('768P')}).strict(),
}).strict();
export type ModelMediaConfig=z.infer<typeof modelMediaSchema>;
const defaults:ModelMediaConfig={image:{enabled:false,referenceEditing:false,baseUrl:'https://api.openai.com/v1',model:'gpt-image-1',size:'1024x1024'},video:{enabled:false,baseUrl:'https://api.minimax.cn/v1',model:'MiniMax-Hailuo-2.3',duration:6,resolution:'768P'}};
type Secrets={config:ModelMediaConfig;imageKey:string;videoKey:string;revision:string};
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
    try{const value=await unseal(directory);return {config:modelMediaSchema.parse(value.config),imageKey:String(value.imageKey||''),videoKey:String(value.videoKey||''),revision:String(value.revision||'unconfigured')};}
    catch(error){
      if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new FlowError('MODEL_MEDIA_VAULT','图片和视频模型配置无法读取');
      // One-time data migration. Model requests never fall back to the old business service.
      try{const old=await unseal(path.join(root,'creative'));const legacy=old.config as Record<string,unknown>;
        const migrated:Secrets={config:modelMediaSchema.parse({image:legacy.image,video:legacy.video}),imageKey:String(old.imageKey||''),videoKey:String(old.videoKey||''),revision:randomUUID()};
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
  async function api(value:Secrets,kind:'image'|'video',route:string,body?:unknown){
    const config=value.config[kind],key=kind==='image'?value.imageKey:value.videoKey;
    const response=await transport(config.baseUrl.replace(/\/$/,'')+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),trustedMiniMax:kind==='video',maxBytes:30_000_000,timeout:180000});
    if(response.status!==200)throw new FlowError('MODEL_MEDIA_HTTP',`模型服务返回 HTTP ${response.status}`);
    let data:any;try{data=JSON.parse(response.body.toString());}catch{throw new FlowError('MODEL_MEDIA_RESPONSE','模型服务响应格式无效');}
    if(kind==='video'&&data.base_resp?.status_code!==0)throw new FlowError('MODEL_MEDIA_RESPONSE','视频模型未接受任务');
    return data;
  }
  async function download(raw:unknown){
    if(typeof raw!=='string'||!raw.startsWith('https://'))throw new FlowError('MODEL_MEDIA_DOWNLOAD','模型结果地址无效');
    const response=await transport(raw,{maxBytes:100_000_000,timeout:120000,trustedMiniMax:true});
    if(response.status!==200)throw new FlowError('MODEL_MEDIA_DOWNLOAD','模型结果下载失败');return response.body;
  }
  async function imageEdit(value:Secrets,prompt:string,bytes:Buffer){
    const form=new FormData();form.set('model',value.config.image.model);form.set('prompt',prompt);form.set('n','1');form.set('size',value.config.image.size);
    form.set('image',new Blob([new Uint8Array(bytes)],{type:'image/png'}),'reference.png');
    const encoded=new Response(form);
    const response=await transport(value.config.image.baseUrl.replace(/\/$/,'')+'/images/edits',{method:'POST',headers:{Authorization:'Bearer '+value.imageKey,'Content-Type':encoded.headers.get('content-type')!},body:Buffer.from(await encoded.arrayBuffer()),maxBytes:30_000_000,timeout:180000});
    if(response.status!==200)throw new FlowError('MODEL_MEDIA_HTTP',`图片编辑模型返回 HTTP ${response.status}`);
    try{return JSON.parse(response.body.toString());}catch{throw new FlowError('MODEL_MEDIA_RESPONSE','图片编辑模型响应无效');}
  }
  async function modelImage(prompt:string,reference?:Buffer){
    const value=await secrets();if(!value.config.image.enabled||!value.imageKey||reference&&!value.config.image.referenceEditing)throw new FlowError('MODEL_MEDIA_UNCONFIGURED','图片模型未配置或未启用');
    let png:Buffer|undefined;
    if(reference){
      if(reference.length>4_000_000)throw new FlowError('MODEL_MEDIA_REFERENCE','参考图超过 4 MB');
      try{const source=sharp(reference,{limitInputPixels:40_000_000}),meta=await source.metadata();if(!['png','jpeg','webp'].includes(meta.format||'')||(meta.pages||1)!==1)throw new Error('format');png=await source.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).png().toBuffer();}
      catch{throw new FlowError('MODEL_MEDIA_REFERENCE','参考图无法解析');}
    }
    const result=png?await imageEdit(value,prompt,png):await api(value,'image','/images/generations',{model:value.config.image.model,prompt,n:1,size:value.config.image.size});
    const item=result.data?.[0],bytes=typeof item?.b64_json==='string'?Buffer.from(item.b64_json,'base64'):await download(item?.url);
    if(!bytes.length||bytes.length>30_000_000)throw new FlowError('MODEL_MEDIA_RESPONSE','图片结果大小无效');
    try{return {bytes:await sharp(bytes,{limitInputPixels:40_000_000}).png().toBuffer(),mime:'image/png',model:value.config.image.model};}
    catch{throw new FlowError('MODEL_MEDIA_RESPONSE','模型未返回有效图片');}
  }
  async function modelVideoSubmit(prompt:string){
    const value=await secrets();if(!value.config.video.enabled||!value.videoKey)throw new FlowError('MODEL_MEDIA_UNCONFIGURED','视频模型未配置或未启用');
    const result=await api(value,'video','/video_generation',{model:value.config.video.model,prompt,duration:6,resolution:'768P',prompt_optimizer:false});
    return {taskId:numericId.parse(result.task_id),fingerprint:digest(JSON.stringify(value.config.video)+value.videoKey),model:value.config.video.model};
  }
  async function modelVideoPoll(taskId:string,fingerprint:string):Promise<{status:'processing'|'completed'|'failed';bytes?:Buffer;model:string}>{
    const value=await secrets();if(digest(JSON.stringify(value.config.video)+value.videoKey)!==fingerprint)throw new FlowError('MODEL_MEDIA_CHANGED','视频模型配置已变更，无法安全查询原任务');
    const result=await api(value,'video','/query/video_generation?task_id='+numericId.parse(taskId));
    if(String(result.task_id)!==taskId)throw new FlowError('MODEL_MEDIA_RESPONSE','视频任务号不匹配');
    if(['Preparing','Queueing','Processing'].includes(result.status))return {status:'processing',model:value.config.video.model};
    if(result.status!=='Success')return {status:'failed',model:value.config.video.model};
    const fileId=numericId.parse(result.file_id),file=await api(value,'video','/files/retrieve?file_id='+fileId);
    if(String(file.file?.file_id)!==fileId)throw new FlowError('MODEL_MEDIA_RESPONSE','视频文件编号不匹配');
    const bytes=await download(file.file?.download_url);
    if(bytes.length<12||bytes.subarray(4,8).toString()!=='ftyp')throw new FlowError('MODEL_MEDIA_RESPONSE','模型未返回有效 MP4');
    return {status:'completed',bytes,model:value.config.video.model};
  }
  return {configuration,configure,modelImage,modelVideoSubmit,modelVideoPoll};
}
