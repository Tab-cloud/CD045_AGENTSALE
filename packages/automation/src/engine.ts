import { randomUUID } from 'node:crypto';
import type { Repository } from '@agentsale/database';
import { assessCosts } from '@agentsale/domain';
import { defaultCosts } from '@agentsale/contracts';
import { createFlowStore } from './storage';
import { createVault } from './vault';
import { assertProvider,searchSuppliers,research,marketing,verifyModel } from './providers';
import { fetchSource } from './network';
import { renderVideo,packageFiles,hash,saveAsset } from './media';
import { FlowError,type Job,type Source,type User } from './types';
import { renderPosters } from './content-media';
import { renderFinalVideo } from './final-video';
import { createMinimax,assertMinimax } from './minimax';

export type Adapters={fetchSource:typeof fetchSource;search:typeof searchSuppliers;research:typeof research;marketing:typeof marketing;render:typeof renderVideo;package:typeof packageFiles;poster:typeof renderPosters;minimax:ReturnType<typeof createMinimax>};
const adapters:Adapters={fetchSource,search:searchSuppliers,research,marketing,render:renderFinalVideo,package:packageFiles,poster:renderPosters,minimax:createMinimax()};
export function createAutomation(repo:Repository,workspace:string,root:string,overrides:Partial<Adapters>={}){
  const store=createFlowStore(repo,workspace),vault=createVault(root+'/private'),providers={...adapters,...overrides};
  async function paid<T>(job:Job,service:'model'|'search'|'speech'|'video',fn:(settings:Awaited<ReturnType<typeof vault.get>>)=>Promise<T>):Promise<T>{
    const settings=await vault.get();if(service==='model')assertProvider(settings);else if(service==='speech'||service==='video')assertMinimax(settings,service);else if(!settings.searchKey)throw new FlowError('SEARCH_UNCONFIGURED','管理员尚未配置搜索服务，可补充供应商链接后创建流程');
    const cents=service==='speech'?settings.minimax.speechLimitCents:service==='video'?settings.minimax.videoLimitCents:service==='search'?settings.searchCallCents:settings.localModel?0:settings.callLimitCents;
    const reserve=await store.reserve(job.id,cents,service,settings,job.input.budgetCents);
    try{const result=await fn(settings);await store.settle(reserve,'confirmed',(result as {usage?:unknown})?.usage||null);return result;}
    catch(e){await store.settle(reserve,'unknown',null);throw e;}
  }
  async function collect(job:Job){
    const settings=await vault.get(),urls=[...new Set([...job.input.urls,...(job.input.product?[job.input.product.sourceUrl]:[])])].slice(0,5),sources:Source[]=[];
    for(const url of urls){try{sources.push(await providers.fetchSource(url,settings.allowedDomains));}catch(e){sources.push({id:hash(url).slice(0,16),url,title:new URL(url).hostname,text:'',hash:'',fetchedAt:new Date().toISOString(),status:'unavailable',error:e instanceof FlowError?e.message:'网页采集失败'});}}
    if(job.input.product){const snapshot=await repo.snapshot(workspace);for(const e of snapshot.evidence.filter(e=>e.productId===job.productId)){sources.push({id:e.id,url:e.url,title:e.title,text:e.note,hash:hash(e.note),status:'imported',fetchedAt:new Date().toISOString()});}
      if(job.input.product.description)sources.push({id:'product-description',url:job.input.product.sourceUrl,title:'商品录入资料',text:job.input.product.description,hash:hash(job.input.product.description),status:'imported',fetchedAt:new Date().toISOString()});}
    return sources;
  }
  async function tick(){
    const claim=await store.claim();if(!claim)return false;const {job,step,lease}=claim;let patch:Partial<Job>={};
    try{
      if(step==='discover'){const urls=job.input.urls.length?job.input.urls:await paid(job,'search',s=>providers.search(job.input.query,s));patch={input:{...job.input,urls}};}
      if(step==='sources'){const sources=await collect(job);patch={sources};if(!sources.some(s=>s.status!=='unavailable'&&s.text.length>=80)){await store.finish(job.id,lease,step,patch,'SOURCE_UNAVAILABLE：没有足够的可读来源，请补充供货资料');return true;}}
      if(step==='cost')patch={cost:assessCosts(job.input.product!.costs)};
      if(step==='research'){const output=await paid(job,'model',s=>providers.research(job,s));patch={research:output.data};}
      if(step==='copy'){const output=await paid(job,'model',s=>providers.marketing(job,s));patch={copy:output.data};}
      if(step==='speech'){const output=await paid(job,'speech',s=>providers.minimax.speech(root,job,s));patch={artifacts:[...job.artifacts,output.artifact]};}
      if(step==='video_wait'){const output=await providers.minimax.poll(root,job,await vault.get());if(output.pending){await store.defer(job.id,lease,output.status);return true;}patch={artifacts:[...job.artifacts,output.artifact],remoteVideo:{...job.remoteVideo!,fileId:output.fileId,status:'Success'},nextRunAt:undefined};}
      if(['poster','render','video_submit'].includes(step)){
        const assets=await store.assets(job.productId||undefined),asset=assets.find(a=>a.id===job.input.assetId)||(!job.input.assetId?assets[0]:undefined);
        if(!asset)throw new FlowError('ASSET_REQUIRED','请为该商品上传已授权图片，然后继续流程');
        patch={input:{...job.input,assetId:asset.id}};
        if(step==='poster')patch.artifacts=[...job.artifacts,...await providers.poster(root,job,asset)];
        if(step==='render')patch.artifacts=[...job.artifacts,...await providers.render(root,job,asset)];
        if(step==='video_submit'){
          if(job.remoteVideo)throw new FlowError('VIDEO_TASK_UNKNOWN','已有视频提交记录，请恢复任务号或查询原任务，不能直接重复提交');
          patch.remoteVideo=await paid(job,'video',async s=>{
            const pending={taskId:'',endpoint:s.minimax.baseUrl,status:'Submitting',submittedAt:new Date().toISOString()};
            // Budget is reserved before this marker and the paid POST.
            await store.checkpoint(job.id,lease,{remoteVideo:pending});patch.remoteVideo=pending;
            return providers.minimax.submit(root,job,asset,s);
          });
        }
      }
      if(step==='package'){
        patch={artifacts:await providers.package(root,job)};
        if(job.kind==='discovery'&&job.research?.selectedIndex!==null&&job.research?.selectedIndex!==undefined){
          const c=job.research.candidates[job.research.selectedIndex],source=job.sources.find(s=>s.id===c.sourceId)!;
          const created=await repo.execute(workspace,{type:'product.create',name:c.product,sku:'AUTO-'+job.id.slice(0,12),supplier:c.name,region:'中国大陆（来源声称，待独立核验）',market:job.research.market!,sourceUrl:source.url,description:job.research.reasoning+'\n待补充：'+job.research.missing.join('；'),costs:{...defaultCosts,revenueMinor:0,procurementCnyMinor:null,shippingMinor:null,feeMinor:0,afterSaleMinor:0,mediaMinor:0,acquisitionMinor:0}},'discovery-'+job.id);
          patch.productId=created.id;patch.productVersion=1;
        }
      }
      await store.finish(job.id,lease,step,patch);await store.audit('automation.step',job.id,job.steps.find(s=>s.key===step)!.label+'已完成');
    }catch(e){if(step==='video_submit'&&FlowError.is(e)&&e.code==='MINIMAX_REJECTED')patch.remoteVideo=undefined;const message=FlowError.is(e)?e.code+'：'+e.message:'STEP_FAILED：此步骤未完成，请检查配置或输入后继续';await store.finish(job.id,lease,step,patch,message);await store.audit('automation.blocked',job.id,message);}
    return true;
  }
  async function verify(){const settings=await vault.get();assertProvider(settings,false);const id=await store.reserve('verify-'+randomUUID(),settings.localModel?0:settings.callLimitCents,'model_verification',settings,settings.localModel?0:settings.callLimitCents);try{const response=await verifyModel(settings);await store.settle(id,'confirmed',response.usage);await vault.verified(settings.revision);return {verified:true,model:response.model};}catch(e){await store.settle(id,'unknown',null);throw e;}}
  async function upload(productId:string,name:string,rights:string,bytes:Buffer){if(!(await repo.snapshot(workspace)).products.some(p=>p.id===productId))throw new FlowError('PRODUCT_MISSING','商品不存在');const saved=await saveAsset(root,workspace,productId,name,rights,bytes);await store.asset(saved);await store.audit('media.upload',saved.id,'已保存商品素材和权利说明');return saved;}
  return {store,vault,tick,verify,upload,root};
}
