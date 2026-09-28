import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, stat } from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import sharp from 'sharp';
import { requestBytes, validUrl } from './network';
import {createVideoEditor,editingAvailable,editPlanSchema} from './video-edit';
import { FlowError } from './types';

const text = (max: number) => z.string().trim().min(1).max(max);
export const creativeConfigSchema = z.object({
  editing: z.object({enabled:z.boolean()}).strict().default({enabled:false}),
  image: z.object({ enabled: z.boolean(), referenceEditing: z.boolean().default(false), baseUrl: z.string().url().max(500), model: text(150), size: z.enum(['1024x1024', '1536x1024', '1024x1536', 'auto']) }).strict(),
  video: z.object({ enabled: z.boolean(), baseUrl: z.enum(['https://api.minimax.cn/v1','https://api.minimaxi.com/v1','https://api.minimax.io/v1']), model: z.enum(['MiniMax-Hailuo-2.3','MiniMax-Hailuo-02']), duration: z.literal(6), resolution: z.literal('768P') }).strict(),
  avatar: z.object({enabled:z.boolean(),meloPythonPath:z.string().max(500),sadTalkerPythonPath:z.string().max(500),sadTalkerPath:z.string().max(500)}).strict().default({enabled:false,meloPythonPath:'',sadTalkerPythonPath:'',sadTalkerPath:''}),
}).strict();
export type CreativeConfig = z.infer<typeof creativeConfigSchema>;
export const creativeDefaults: CreativeConfig = {
  editing:{enabled:false},
  image: { enabled: false, referenceEditing: false, baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1', size: '1024x1024' },
  video: { enabled: false, baseUrl: 'https://api.minimax.cn/v1', model: 'MiniMax-Hailuo-2.3', duration: 6, resolution: '768P' },
  avatar: {enabled:false,meloPythonPath:'',sadTalkerPythonPath:'',sadTalkerPath:''},
};
export const creativeRequestSchema = z.object({ id: z.string().uuid(), kind: z.enum(['image','video','avatar']), prompt: text(2500), portraitId:z.string().uuid().optional(), referenceId: z.string().uuid().optional(), editPlan:editPlanSchema.optional() }).strict().refine(r => !r.referenceId || r.kind === 'image', '参考图仅用于图片生成').refine(r=>!r.editPlan||r.kind==='video','剪辑仅支持视频').refine(r=>r.kind!=='avatar'||!!r.portraitId,'数字人任务需要授权人像照片').refine(r=>r.kind==='avatar'||!r.portraitId,'人像照片仅用于数字人视频');
type Request = z.infer<typeof creativeRequestSchema>;
type Secrets = { config: CreativeConfig; imageKey: string; videoKey: string };
export type CreativeJob = Request & { fingerprint: string; status: 'submitting'|'processing'|'completed'|'unknown'|'failed'; taskId?: string; fileId?: string; mime?: string; file?: string; message: string; updatedAt: string };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const idSchema = z.string().regex(/^\d{1,64}$/);

/** Web owns credentials and provider transport; planning and orchestration live in Rust. */
export function createCreativeService(root: string, transport: typeof requestBytes = requestBytes, owner?: string) {
  const directory = path.join(root, 'creative');
  const jobDirectory = owner ? path.join(directory,'members',z.string().uuid().parse(owner)) : directory;
  const editor=createVideoEditor(path.join(jobDirectory,'video-sources'));
  let writes: Promise<unknown> = Promise.resolve();
  const active = new Map<string, Promise<CreativeJob>>();
  async function atomic(file: string, value: string | Buffer) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = file + '.' + randomUUID();
    await writeFile(temp, value, { mode: 0o600 }); await rename(temp, file);
  }
  async function key() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, 'credentials.key');
    try { return await readFile(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    try { await writeFile(file, randomBytes(32), { mode: 0o600, flag: 'wx' }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    return readFile(file);
  }
  async function secrets(): Promise<Secrets> {
    let bytes: Buffer;
    try { bytes = await readFile(path.join(directory, 'credentials.sealed')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { config: structuredClone(creativeDefaults), imageKey: '', videoKey: '' }; throw e; }
    try {
      const cipher = createDecipheriv('aes-256-gcm', await key(), bytes.subarray(0,12)); cipher.setAuthTag(bytes.subarray(12,28));
      const value = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString());
      const config=value.config?.avatar?.baseUrl?{...value.config,avatar:creativeDefaults.avatar}:value.config;
      return { config: creativeConfigSchema.parse(config), imageKey: value.imageKey, videoKey: value.videoKey };
    } catch { throw new FlowError('CREATIVE_VAULT', '无法读取创作服务配置，请检查本机配置文件'); }
  }
  const publicConfig = (s: Secrets) => ({ ...s.config, hasImageKey: !!s.imageKey, hasVideoKey: !!s.videoKey });
  async function configure(raw: unknown, imageKey?: string, videoKey?: string) {
    const operation = writes.then(async () => {
      const config = creativeConfigSchema.parse(raw);
      const endpoint = validUrl(config.image.baseUrl);
      if (endpoint.protocol !== 'https:' || endpoint.search) throw new FlowError('CREATIVE_ENDPOINT', '图片服务需使用不含查询参数的 HTTPS 接口地址');
      for (const value of [imageKey,videoKey]) if (value !== undefined && (value.length > 4000 || /[\r\n]/.test(value))) throw new FlowError('CREATIVE_KEY', '密钥格式无效');
      const old = await secrets();
      const next: Secrets = { config, imageKey: imageKey?.trim() ?? (old.config.image.baseUrl === config.image.baseUrl ? old.imageKey : ''), videoKey: videoKey?.trim() ?? (old.config.video.baseUrl === config.video.baseUrl ? old.videoKey : '') };
      if ((config.image.enabled && !next.imageKey) || (config.video.enabled && !next.videoKey)) throw new FlowError('CREATIVE_KEY', '启用服务前请填写对应密钥');
      if(config.avatar.enabled)await validateAvatarInstallation(config.avatar);
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', await key(), iv), encrypted = Buffer.concat([cipher.update(JSON.stringify(next)), cipher.final()]);
      await atomic(path.join(directory, 'credentials.sealed'), Buffer.concat([iv, cipher.getAuthTag(), encrypted]));
      return publicConfig(next);
    });
    writes = operation.catch(() => undefined); return operation;
  }
  async function capabilities() {
    const s = await secrets();
    return { videoEditing: s.config.editing.enabled && await editingAvailable(), image: s.config.image.enabled && !!s.imageKey, video: s.config.video.enabled && !!s.videoKey,avatar:s.config.avatar.enabled, referenceEditing: s.config.image.enabled && !!s.imageKey && s.config.image.referenceEditing, imageSize: s.config.image.size, videoSeconds: s.config.video.duration, maxAssets: 4 };
  }
  const jobPath = (id: string) => path.join(jobDirectory, z.string().uuid().parse(id), 'job.json');
  async function load(id: string): Promise<CreativeJob> { return JSON.parse(await readFile(jobPath(id), 'utf8')); }
  async function save(job: CreativeJob) { job.updatedAt = new Date().toISOString(); await atomic(jobPath(job.id), JSON.stringify(job)); return job; }
  const fingerprint = (s: Secrets, kind: Request['kind']) => digest(JSON.stringify(s.config[kind]) + (kind === 'image' ? s.imageKey : kind==='avatar'?'':s.videoKey));
  async function api(s: Secrets, kind: Request['kind'], route: string, body?: unknown) {
    if(kind==='avatar')throw new FlowError('CREATIVE_PROVIDER','数字人服务调用方式无效');
    const result = await transport(s.config[kind].baseUrl.replace(/\/$/,'') + route, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + (kind === 'image' ? s.imageKey : s.videoKey), 'Content-Type':'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), trustedMiniMax: kind === 'video', maxBytes: 30_000_000, timeout: 180000 });
    if (result.status !== 200) throw new FlowError('CREATIVE_PROVIDER', `生成服务返回 HTTP ${result.status}，请检查权限、参数与额度；不会自动重复提交`);
    let data: any; try { data = JSON.parse(result.body.toString()); } catch { throw new FlowError('CREATIVE_RESPONSE', '生成服务响应格式无效'); }
    if (kind === 'video' && data.base_resp?.status_code !== 0) throw new FlowError('CREATIVE_PROVIDER', '视频服务未接受请求，请在服务商后台核对');
    return data;
  }
  async function validateAvatarInstallation(config:CreativeConfig['avatar']) {
    if (!path.isAbsolute(config.meloPythonPath) || !path.isAbsolute(config.sadTalkerPythonPath) || !path.isAbsolute(config.sadTalkerPath)) throw new FlowError('AVATAR_SETUP','请填写 Python 与 SadTalker 的绝对路径');
    try {
      if(!(await stat(config.meloPythonPath)).isFile() || !(await stat(config.sadTalkerPythonPath)).isFile() || !(await stat(path.join(config.sadTalkerPath,'inference.py'))).isFile() || !(await stat(path.join(config.sadTalkerPath,'checkpoints'))).isDirectory())throw new Error('missing');
    } catch {throw new FlowError('AVATAR_SETUP','未找到 SadTalker 程序或模型权重，请先完成本地安装');}
  }
  async function workerPath(){
    for(const candidate of [path.resolve(process.cwd(),'apps/web/packages/automation/src/local-avatar-worker.py'),path.resolve(process.cwd(),'../packages/automation/src/local-avatar-worker.py')]){
      try {if((await stat(candidate)).isFile())return candidate;}catch{}
    }
    throw new FlowError('AVATAR_SETUP','本地数字人生成脚本不存在');
  }
  const portraitPath=(id:string)=>path.join(jobDirectory,'portraits',z.string().uuid().parse(id)+'.png');
  async function importPortrait(data:string){
    if(data.length>5_333_336||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))throw new FlowError('AVATAR_PORTRAIT','请选择不超过 4 MB 的 PNG、JPEG 或 WebP 人像照片');
    const bytes=Buffer.from(data,'base64');if(!bytes.length||bytes.length>4_000_000)throw new FlowError('AVATAR_PORTRAIT','人像照片超过 4 MB');
    let png:Buffer;
    try{const input=sharp(bytes,{limitInputPixels:40_000_000}),meta=await input.metadata();if(!['png','jpeg','webp'].includes(meta.format||'')||(meta.pages||1)!==1)throw new Error('format');png=await input.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).png().toBuffer();}
    catch{throw new FlowError('AVATAR_PORTRAIT','无法解析人像照片，请使用静态 PNG、JPEG 或 WebP');}
    const id=randomUUID();await atomic(portraitPath(id),png);return {id};
  }
  async function validatePortrait(id:string){try{await stat(portraitPath(id));}catch{throw new FlowError('AVATAR_PORTRAIT','人像照片不存在或不属于当前账号，请重新上传');}}
  async function launchAvatar(config:CreativeConfig['avatar'],job:CreativeJob){
    const folder=path.dirname(jobPath(job.id));
    await atomic(path.join(folder,'worker-input.json'),JSON.stringify({script:job.prompt,portrait:portraitPath(job.portraitId!),repo:config.sadTalkerPath,python:config.sadTalkerPythonPath,output:folder}));
    const child=spawn(config.meloPythonPath,[await workerPath(),path.join(folder,'worker-input.json')],{cwd:config.sadTalkerPath,stdio:'ignore',detached:true});
    child.on('error',()=>{void atomic(path.join(folder,'worker-result.json'),JSON.stringify({status:'failed',message:'本地数字人进程启动失败'})).catch(()=>{});});
    child.unref();
  }
  async function download(url: unknown) {
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new FlowError('CREATIVE_DOWNLOAD', '作品下载地址无效');
    const response = await transport(url, { maxBytes: 100_000_000, timeout: 120000, trustedMiniMax: true });
    if (response.status !== 200) throw new FlowError('CREATIVE_DOWNLOAD', '作品下载失败，可重新查询原任务');
    return response.body;
  }
  async function storeImage(job: CreativeJob, bytes: Buffer) {
    const png = await sharp(bytes, { limitInputPixels: 40_000_000 }).png().toBuffer();
    job.file = 'image.png'; job.mime = 'image/png';
    await atomic(path.join(jobDirectory, job.id, job.file), png);
  }
  const referencePath = (id: string) => path.join(jobDirectory, 'references', z.string().uuid().parse(id) + '.png');
  async function reference(id: string) {
    try { return await readFile(referencePath(id)); }
    catch { throw new FlowError('CREATIVE_REFERENCE', '商品参考图不存在或不属于当前账号，请重新导入'); }
  }
  async function validateReference(id: string) {
    await reference(id);
    if (!(await capabilities()).referenceEditing) throw new FlowError('CREATIVE_UNCONFIGURED', '平台尚未启用商品参考图生成，请联系管理员启用图片编辑服务');
  }
  async function importReference(data: string) {
    if (data.length > 5_333_336 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new FlowError('CREATIVE_REFERENCE', '请选择不超过 4 MB 的 PNG、JPEG 或 WebP 商品图');
    const bytes = Buffer.from(data,'base64');
    if (!bytes.length || bytes.length > 4_000_000) throw new FlowError('CREATIVE_REFERENCE', '商品图超过 4 MB');
    let png: Buffer;
    try {
      const source = sharp(bytes,{limitInputPixels:40_000_000}), meta = await source.metadata();
      if (!['png','jpeg','webp'].includes(meta.format || '') || (meta.pages || 1) !== 1) throw new Error('format');
      png = await source.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).png().toBuffer();
    } catch { throw new FlowError('CREATIVE_REFERENCE', '商品图无法解析，请使用静态 PNG、JPEG 或 WebP 图片'); }
    // A content-derived UUID deduplicates re-imports; each account has its own directory.
    const hash = digest(png.toString('base64'));
    const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
    const files = await readdir(path.dirname(referencePath(id))).catch((e: NodeJS.ErrnoException) => {if(e.code==='ENOENT')return [] as string[];throw e;});
    if (files.length >= 100 && !files.includes(id+'.png')) throw new FlowError('CREATIVE_REFERENCE', '当前账号已保存 100 张参考图，请复用已有任务中的商品图');
    await atomic(referencePath(id),png);
    return {id};
  }
  async function editImage(s: Secrets, request: Request) {
    const form = new FormData();
    form.set('model',s.config.image.model);form.set('prompt',request.prompt);form.set('n','1');form.set('size',s.config.image.size);
    form.set('image',new Blob([new Uint8Array(await reference(request.referenceId!))],{type:'image/png'}),'product.png');
    const encoded = new Response(form);
    const response = await transport(s.config.image.baseUrl.replace(/\/$/,'')+'/images/edits',{method:'POST',headers:{Authorization:'Bearer '+s.imageKey,'Content-Type':encoded.headers.get('content-type')!},body:Buffer.from(await encoded.arrayBuffer()),maxBytes:30_000_000,timeout:180000});
    if(response.status!==200)throw new FlowError('CREATIVE_PROVIDER','商品图生成服务未接受请求');
    return JSON.parse(response.body.toString());
  }
  async function start(raw: unknown) {
    const request = creativeRequestSchema.parse(raw);
    // Exclusive creation on disk prevents double submissions, including multiple server instances.
    let existing: CreativeJob | undefined;
    try { existing = await load(request.id); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (existing) {
      if (existing.kind !== request.kind || existing.prompt !== request.prompt || existing.referenceId !== request.referenceId || existing.portraitId!==request.portraitId||JSON.stringify(existing.editPlan)!==JSON.stringify(request.editPlan)) throw new FlowError('CREATIVE_CONFLICT', '同一任务号不能用于不同内容');
      return existing;
    }
    const s = await secrets();
    if (!request.editPlan && (!s.config[request.kind].enabled || (request.kind === 'image' && !s.imageKey) || (request.kind === 'video' && !s.videoKey))) throw new FlowError('CREATIVE_UNCONFIGURED', '请先在 Web 端启用对应的图片、视频或数字人服务');
    if (request.referenceId) await validateReference(request.referenceId);
    if (request.editPlan) {if(!(await capabilities()).videoEditing)throw new FlowError('CREATIVE_UNCONFIGURED','平台剪辑服务尚未启用，请联系管理员');await editor.validate(request.editPlan);}
    if(request.kind==='avatar'){await validateAvatarInstallation(s.config.avatar);await validatePortrait(request.portraitId!);}
    const job: CreativeJob = { ...request, fingerprint: fingerprint(s, request.kind), status:'submitting', message:'已提交生成请求，等待服务响应', updatedAt:new Date().toISOString() };
    await mkdir(path.dirname(jobPath(job.id)), { recursive:true, mode:0o700 });
    try { await writeFile(jobPath(job.id), JSON.stringify(job), { mode:0o600, flag:'wx' }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return start(request); throw e; }
    try {
      if(request.editPlan){
        await editor.render(request.editPlan,path.join(jobDirectory,job.id,'video.mp4'));job.file='video.mp4';job.mime='video/mp4';job.status='completed';job.message='剪辑成片已保存';
      } else if (request.kind === 'image') {
        const data = request.referenceId ? await editImage(s,request) : await api(s,'image','/images/generations',{ model:s.config.image.model, prompt:request.prompt, n:1, size:s.config.image.size });
        const result = data.data?.[0];
        const bytes = typeof result?.b64_json === 'string' ? Buffer.from(result.b64_json,'base64') : await download(result?.url);
        await storeImage(job, bytes); job.status='completed'; job.message='图片已生成并保存';
      } else if(request.kind==='avatar'){
        await launchAvatar(s.config.avatar,job);job.taskId=job.id;job.status='processing';job.message='本地数字人已开始生成配音和口播视频';
      } else {
        const data = await api(s,'video','/video_generation',{ model:s.config.video.model, prompt:request.prompt, duration:s.config.video.duration, resolution:s.config.video.resolution, prompt_optimizer:false });
        job.taskId = idSchema.parse(data.task_id); job.status='processing'; job.message='视频任务已受理，等待生成';
      }
    } catch {
      job.status=request.editPlan||request.kind==='avatar'?'failed':'unknown'; job.message=request.kind==='avatar'?'本地数字人启动失败，请管理员检查模型安装与运行日志':request.editPlan?'视频剪辑失败或超时；请联系管理员检查渲染服务，本任务不会重复执行':'生成提交或接收结果未确认，请核对服务商后台；本任务不会重复提交';
    }
    return save(job);
  }
  async function poll(id: string) {
    const job = await load(id);
    if (job.editPlan || !['video','avatar'].includes(job.kind) || job.status !== 'processing' || !job.taskId) return job;
    if(job.kind==='avatar'&&!job.portraitId){job.status='failed';job.message='旧版数字人任务已停用，请上传授权人像照片重新创建任务';return save(job);}
    const s = await secrets();
    if (fingerprint(s,job.kind) !== job.fingerprint) throw new FlowError('CREATIVE_CHANGED', '视频服务配置已变更，请恢复提交时的配置后继续查询');
    if(job.kind==='avatar'){
      const folder=path.dirname(jobPath(job.id));
      let result:{status:string;message?:string};
      try{result=JSON.parse(await readFile(path.join(folder,'worker-result.json'),'utf8'));}
      catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT'){const stage=await readFile(path.join(folder,'worker-stage.txt'),'utf8').catch(()=>null);if(stage&&stage!==job.message){job.message=stage;return save(job);}return job;}throw new FlowError('AVATAR_RESULT','本地数字人结果文件无效');}
      if(result.status!=='completed'){job.status='failed';job.message=result.message||'本地数字人生成失败，请管理员检查模型环境';return save(job);}
      const bytes=await readFile(path.join(folder,'video.mp4'));
      if(bytes.length<12||bytes.subarray(4,8).toString()!=='ftyp')throw new FlowError('CREATIVE_MEDIA','本地数字人未生成有效 MP4');
      job.file='video.mp4';job.mime='video/mp4';job.status='completed';job.message='数字人口播视频已生成并保存';return save(job);
    }
    const result = await api(s,'video','/query/video_generation?task_id='+idSchema.parse(job.taskId));
    if (String(result.task_id) !== job.taskId) throw new FlowError('CREATIVE_MISMATCH', '视频服务返回的任务号不匹配');
    if (['Preparing','Queueing','Processing'].includes(result.status)) { job.message='视频生成中：'+result.status; return save(job); }
    if (result.status !== 'Success') { job.status='failed'; job.message='视频服务生成失败，请检查服务商后台'; return save(job); }
    job.fileId = idSchema.parse(result.file_id);
    const file = await api(s,'video','/files/retrieve?file_id='+job.fileId);
    if (String(file.file?.file_id) !== job.fileId) throw new FlowError('CREATIVE_MISMATCH', '视频文件编号不匹配');
    const bytes = await download(file.file?.download_url);
    if (bytes.length < 12 || bytes.subarray(4,8).toString() !== 'ftyp') throw new FlowError('CREATIVE_MEDIA', '服务未返回有效 MP4 容器');
    job.file='video.mp4'; job.mime='video/mp4'; await atomic(path.join(jobDirectory,job.id,job.file),bytes);
    job.status='completed'; job.message='视频已生成并保存'; return save(job);
  }
  async function exclusive(id: string, operation: () => Promise<CreativeJob>) {
    const previous = active.get(id); if (previous) await previous;
    const promise = operation(); active.set(id,promise);
    try { return await promise; } finally { if (active.get(id) === promise) active.delete(id); }
  }
  return {
    configuration: async () => publicConfig(await secrets()), configure, capabilities, importPortrait, validatePortrait, importReference, validateReference,
    async validateEdit(raw:unknown){if(!(await capabilities()).videoEditing)throw new FlowError('VIDEO_ENGINE','平台剪辑服务未启用');return editor.validate(raw);},
    async importVideo(data:string,name:string){if(!(await capabilities()).videoEditing)throw new FlowError('VIDEO_ENGINE','请联系管理员启用平台剪辑服务');return editor.importVideo(data,name);},
    start: (raw: unknown) => { const request=creativeRequestSchema.parse(raw); return exclusive(request.id,()=>start(request)); },
    poll: (id: string) => exclusive(z.string().uuid().parse(id),()=>poll(id)),
    async asset(id: string) { const job=await load(id); if (job.status !== 'completed' || !job.file || !job.mime) throw new FlowError('CREATIVE_PENDING','作品尚未生成'); return { bytes:await readFile(path.join(jobDirectory,job.id,path.basename(job.file))), mime:job.mime }; },
  };
}
