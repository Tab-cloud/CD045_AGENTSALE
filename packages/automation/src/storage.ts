import { sql } from 'drizzle-orm';
import { randomUUID,createHash } from 'node:crypto';
import type { Repository } from '@agentsale/database';
import { DomainError } from '@agentsale/domain';
import { FlowError,startSchema,copySchema,stepLabels,type Asset,type Job,type Start,type StepKey,type User,type SecretSettings } from './types';
export function createFlowStore(repo:Repository,workspace:string){
  const now=()=>new Date().toISOString();
  type Tx=Parameters<Parameters<Repository['scoped']>[1]>[0];
  async function list(){return repo.scoped(workspace,async tx=>(await tx.execute(sql`SELECT document FROM automation_jobs ORDER BY created_at DESC LIMIT 100`)).rows.map(r=>r.document as Job));}
  async function get(id:string){return repo.scoped(workspace,async tx=>{const row=(await tx.execute(sql`SELECT document FROM automation_jobs WHERE id=${id}`)).rows[0];if(!row)throw new DomainError('NOT_FOUND','流程不存在',404);return row.document as Job;});}
  async function audit(action:string,objectId:string,summary:string){await repo.scoped(workspace,async tx=>{await tx.execute(sql`INSERT INTO audit(id,workspace_id,action,object_id,summary,created_at) VALUES(${randomUUID()},${workspace},${action},${objectId},${summary},${now()})`);});}
  async function create(raw:unknown,actor:User,key:string,conversationId?:string){
    const parsed=startSchema.safeParse(raw);if(!parsed.success)throw new DomainError('INPUT_INVALID','流程参数不完整');if(!/^[0-9a-f-]{36}$/.test(key))throw new DomainError('IDEMPOTENCY_REQUIRED','缺少流程操作标识');
    const input:Start=parsed.data,requestHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return repo.scoped(workspace,async tx=>{
      const old=(await tx.execute(sql`SELECT document FROM automation_jobs WHERE id=${key}`)).rows[0];
      if(old){const job=old.document as Job;if(job.requestHash!==requestHash||job.createdBy!==actor.id)throw new DomainError('IDEMPOTENCY_CONFLICT','同一操作标识不能用于不同流程参数',409);return job;}
      let product; if(input.productId){const row=(await tx.execute(sql`SELECT * FROM products WHERE id=${input.productId}`)).rows[0];if(!row)throw new DomainError('NOT_FOUND','商品不存在',404);
        if(row.version!==input.expectedVersion)throw new DomainError('VERSION_CONFLICT','商品资料已变化，请重新创建流程',409);
        product={id:String(row.id),workspaceId:workspace,name:String(row.name),sku:String(row.sku),supplier:String(row.supplier),region:String(row.region),market:String(row.market),description:String(row.description),sourceUrl:String(row.source_url),costs:row.costs as any,version:Number(row.version),sample:Boolean(row.sample),createdAt:String(row.created_at),updatedAt:String(row.updated_at)};
      }
      if(input.kind!=='discovery'&&!product)throw new DomainError('PRODUCT_REQUIRED','此流程需要关联商品');
      if(input.kind==='render'&&(!input.script||!input.assetId))throw new DomainError('MEDIA_REQUIRED','请提供脚本与已授权图片');
      const media:StepKey[]=['poster',...(input.voiceover?['speech' as const]:[]),...(input.videoMode==='minimax'?['video_submit' as const,'video_wait' as const]:[]),'render','package'];
      const keys:StepKey[]=input.kind==='discovery'?['discover','sources','research','package']:input.kind==='render'?media:input.kind==='content'?['sources','copy',...media]:['sources','cost','research','copy',...media];
      const job:Job={id:key,workspaceId:workspace,...(conversationId?{conversationId}:{}),createdBy:actor.id,requestHash,productId:product?.id||null,productVersion:product?.version||null,kind:input.kind,state:'queued',version:1,
        input:{query:input.query||'China mainland manufacturer supplier single item dropshipping overseas shipping countries',urls:input.urls,product,script:input.script,assetId:input.assetId,budgetCents:input.budgetCents,voiceover:input.voiceover,videoMode:input.videoMode},
        steps:keys.map(key=>({key,label:stepLabels[key],state:'pending',attempts:0,summary:''})),sources:[],artifacts:[],error:'',lease:null,createdAt:now(),updatedAt:now(),...(input.script?{copy:input.script}:{})};
      await tx.execute(sql`INSERT INTO automation_jobs(id,workspace_id,state,document,created_at) VALUES(${key},${workspace},${job.state},${JSON.stringify(job)}::jsonb,${job.createdAt})`);
      return job;
    });
  }
  async function mutate(id:string,fn:(job:Job,tx:Tx)=>void|Promise<void>){return repo.scoped(workspace,async tx=>{const row=(await tx.execute(sql`SELECT document FROM automation_jobs WHERE id=${id} FOR UPDATE`)).rows[0];if(!row)throw new DomainError('NOT_FOUND','流程不存在',404);const job=row.document as Job;await fn(job,tx);job.version++;job.updatedAt=now();await tx.execute(sql`UPDATE automation_jobs SET state=${job.state},document=${JSON.stringify(job)}::jsonb WHERE id=${id}`);return job;});}
  async function control(id:string,action:'pause'|'resume'|'cancel'|'approve',version:number,actor:User){
    const job=await mutate(id,async(j,tx)=>{
      if(action==='approve'&&j.productId){const product=(await tx.execute(sql`SELECT version FROM products WHERE id=${j.productId} FOR UPDATE`)).rows[0];if(product?.version!==j.productVersion)throw new DomainError('VERSION_CONFLICT','商品资料已变化，不能审阅旧产物',409);}
      if(j.version!==version)throw new DomainError('VERSION_CONFLICT','流程状态已变化，请刷新',409);
      if(action==='pause'){if(!['queued','running'].includes(j.state))throw new DomainError('INVALID_STATE','当前状态不能暂停',409);j.state='paused';}
      if(action==='cancel'){if(['succeeded','cancelled'].includes(j.state))throw new DomainError('INVALID_STATE','流程已结束',409);j.state='cancelled';}
      if(action==='resume'){if(!['paused','blocked'].includes(j.state)||j.steps.some(s=>s.state==='running'))throw new DomainError('INVALID_STATE','流程无法继续，请等待当前步骤结束',409);if(j.error.startsWith('VERSION_CONFLICT'))throw new DomainError('VERSION_CONFLICT','请依据最新商品新建流程',409);j.state='queued';j.error='';for(const s of j.steps)if(s.state==='blocked'||s.state==='failed')s.state='pending';}
      if(action==='approve'){if(j.state!=='waiting_review')throw new DomainError('INVALID_STATE','流程尚未到审阅阶段',409);j.state='succeeded';j.reviewedBy=actor.username;}
    });await audit('automation.'+action,id,actor.username+'：'+({pause:'暂停流程',resume:'继续流程',cancel:'取消流程',approve:'审阅流程产物，未对外发布'}[action]));return job;
  }
  async function claim(){return repo.scoped(workspace,async tx=>{
    const row=(await tx.execute(sql`SELECT document FROM automation_jobs WHERE state IN ('queued','running') AND document->>'lease' IS NULL AND (document->>'nextRunAt' IS NULL OR document->>'nextRunAt'<=${now()}) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];if(!row)return null;
    const job=row.document as Job,step=job.steps.find(s=>s.state==='pending');if(!step)return null;
    if(job.productId){const p=(await tx.execute(sql`SELECT version FROM products WHERE id=${job.productId}`)).rows[0];if(p?.version!==job.productVersion){job.state='blocked';job.error='VERSION_CONFLICT：商品资料已变化，请创建新流程';step.state='blocked';}}
    if(job.state!=='blocked'){job.state='running';job.lease=randomUUID();step.state='running';step.attempts++;step.startedAt=now();}
    job.version++;job.updatedAt=now();await tx.execute(sql`UPDATE automation_jobs SET state=${job.state},document=${JSON.stringify(job)}::jsonb WHERE id=${job.id}`);
    return job.state==='blocked'?null:{job,step:step.key,lease:job.lease!};
  });}
  async function revise(id:string,version:number,raw:unknown,actor:User){const parsed=copySchema.safeParse(raw);if(!parsed.success)throw new DomainError('COPY_INVALID','请补齐标题、正文和三段分镜');const job=await mutate(id,async(j,tx)=>{
    if(j.version!==version||j.lease||!['waiting_review','succeeded','blocked'].includes(j.state)||!j.copy)throw new DomainError('VERSION_CONFLICT','当前流程不可修订，请刷新状态',409);
    if(j.productId){const p=(await tx.execute(sql`SELECT version FROM products WHERE id=${j.productId} FOR UPDATE`)).rows[0];if(p?.version!==j.productVersion)throw new DomainError('VERSION_CONFLICT','商品资料已变更，请创建新流程',409);}
    if(j.kind!=='render'&&parsed.data.scenes.some(s=>!s.sourceIds.length||s.sourceIds.some(id=>!j.sources.some(source=>source.id===id&&source.status!=='unavailable'))))throw new DomainError('CITATION_INVALID','修订后的分镜仍需保留有效来源');
    if(j.remoteVideo?.status==='Submitting'&&!j.remoteVideo.taskId)throw new DomainError('VIDEO_TASK_UNKNOWN','请先核对未知的视频提交结果再修订',409);
    if(parsed.data.listing){for(const id of [...parsed.data.listing.sourceIds,...parsed.data.listing.specifications.map(s=>s.sourceId)])if(!j.sources.some(s=>s.id===id&&s.status!=='unavailable'))throw new DomainError('CITATION_INVALID','商品详情引用无效');}
    if(!j.steps.some(s=>s.key==='poster'))j.steps.splice(j.steps.findIndex(s=>s.key==='render'),0,{key:'poster',label:stepLabels.poster,state:'pending',attempts:0,summary:''});
    j.copy=parsed.data;j.artifacts=[];j.remoteVideo=undefined;j.nextRunAt=undefined;j.reviewedBy=undefined;j.error='';j.state='queued';for(const step of j.steps)if(['poster','speech','video_submit','video_wait','render','package'].includes(step.key)){step.state='pending';step.summary='文案已修订，等待重新生成';}
  });await audit('automation.revise',id,actor.username+' 修订文案，旧审阅和视频已失效');return job;}
  async function finish(id:string,lease:string,key:StepKey,patch:Partial<Job>,error?:string){return mutate(id,j=>{
    if(j.lease!==lease)throw new FlowError('LEASE_CHANGED','步骤执行权已变化');const step=j.steps.find(s=>s.key===key)!;
    Object.assign(j,patch);j.lease=null;step.finishedAt=now();step.state=error?'blocked':'done';step.summary=error||({discover:'供货来源已找到',sources:'来源正文与采集时间已保存',cost:'成本计算完成，缺失项保留',research:'供应商、发货证据及市场判断已保存',copy:'完整商品文案已生成，等待人工核实',poster:'三种尺寸海报已保存',speech:'MiniMax 配音已保存',video_submit:'远程视频任务号已保存',video_wait:'海螺视频已下载并检查',render:'MP4 已编码并通过媒体检查',package:'交付文件与清单已保存'}[key]);
    if(error)j.error=error;
    if(!['paused','cancelled'].includes(j.state))j.state=error?'blocked':j.steps.every(s=>s.state==='done')?'waiting_review':'queued';
  });}
  async function recover(){const jobs=await repo.scoped(workspace,async tx=>(await tx.execute(sql`SELECT document FROM automation_jobs WHERE document->>'lease' IS NOT NULL`)).rows.map(r=>r.document as Job));for(const j of jobs)if(j.lease)await mutate(j.id,job=>{const s=job.steps.find(x=>x.state==='running');if(s){s.state='blocked';s.summary='运行进程中断，请确认后继续；可能产生费用的调用不自动重发';}job.lease=null;if(job.state!=='cancelled')job.state='blocked';job.error='INTERRUPTED：'+(s?.summary||'运行中断');});}
  async function checkpoint(id:string,lease:string,patch:Partial<Job>){return mutate(id,j=>{if(j.lease!==lease)throw new FlowError('LEASE_CHANGED','执行权已变化');Object.assign(j,patch);});}
  async function defer(id:string,lease:string,status:string){return mutate(id,j=>{if(j.lease!==lease)throw new FlowError('LEASE_CHANGED','执行权已变化');j.lease=null;j.nextRunAt=new Date(Date.now()+15000).toISOString();const step=j.steps.find(s=>s.key==='video_wait')!;step.state='pending';step.summary='海螺视频正在排队或生成，稍后自动查询';if(!['paused','cancelled'].includes(j.state))j.state='queued';if(j.remoteVideo)j.remoteVideo.status=status;});}
  async function recoverVideo(id:string,version:number,taskId:string,actor:User){if(!/^\d{1,64}$/.test(taskId))throw new DomainError('TASK_ID_INVALID','任务号格式无效');const result=await mutate(id,j=>{if(j.version!==version||j.lease||j.state!=='blocked'||j.remoteVideo?.status!=='Submitting'||j.remoteVideo.taskId)throw new DomainError('INVALID_STATE','当前不需要恢复任务号');j.remoteVideo.taskId=taskId;j.remoteVideo.status='Recovered';j.steps.find(s=>s.key==='video_submit')!.state='done';j.steps.find(s=>s.key==='video_wait')!.state='pending';j.state='queued';j.error='';});await audit('automation.video_recover',id,actor.username+' 填写 MiniMax 后台任务号恢复查询');return result;}
  async function assets(productId?:string){return repo.scoped(workspace,async tx=>(await tx.execute(productId?sql`SELECT document FROM media_assets WHERE product_id=${productId}`:sql`SELECT document FROM media_assets`)).rows.map(r=>r.document as Asset));}
  async function asset(value:Asset){await repo.scoped(workspace,async tx=>{await tx.execute(sql`INSERT INTO media_assets(id,workspace_id,product_id,document) VALUES(${value.id},${workspace},${value.productId},${JSON.stringify(value)}::jsonb)`);});}
  async function reserve(jobId:string,cents:number,service:string,config:SecretSettings,jobBudget:number){
    return repo.scoped(workspace,async tx=>{await tx.execute(sql`SELECT pg_advisory_xact_lock(450202)`);const daily=(await tx.execute(sql`SELECT COALESCE(SUM(reserved_cents),0) AS total FROM automation_spend WHERE created_at>=${now().slice(0,10)}`)).rows[0];const perJob=(await tx.execute(sql`SELECT COALESCE(SUM(reserved_cents),0) AS total FROM automation_spend WHERE job_id=${jobId}`)).rows[0];
      if((config.dailyLimitCents>0&&Number(daily.total)+cents>config.dailyLimitCents)||Number(perJob.total)+cents>jobBudget)throw new FlowError('BUDGET_EXCEEDED','任务预算不足；已完成步骤保留');
      const id=randomUUID();await tx.execute(sql`INSERT INTO automation_spend(id,workspace_id,job_id,service,reserved_cents,status,created_at) VALUES(${id},${workspace},${jobId},${service},${cents},'reserved',${now()})`);return id;
    });
  }
  async function settle(id:string,status:'confirmed'|'unknown',usage:unknown){await repo.scoped(workspace,async tx=>{await tx.execute(sql`UPDATE automation_spend SET status=${status},usage=${JSON.stringify(usage)}::jsonb WHERE id=${id}`);});}
  async function spend(){return repo.scoped(workspace,async tx=>(await tx.execute(sql`SELECT service,reserved_cents,status,created_at FROM automation_spend ORDER BY created_at DESC LIMIT 100`)).rows);}
  return {list,get,create,control,revise,claim,finish,recover,checkpoint,defer,recoverVideo,assets,asset,reserve,settle,spend,audit};
}
