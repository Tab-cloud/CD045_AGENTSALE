import {textGenerationSchema,generateText} from '../../packages/automation/src/model-gateway';
import {FlowError} from '../../packages/automation/src/types';
import {modelVault} from './local-runtime';
import {platform} from './platform';
import {finishTextStream,publishTextDelta} from './model-text-stream';

// The queue holds encrypted generic model messages for a short time. It never
// stores desktop research state or decides which Agent step to run next.
type Completion = typeof generateText;
let lastSweep=0;
export async function processNextTextRequest(complete:Completion=generateText):Promise<boolean>{
  const p=await platform();
  if(Date.now()-lastSweep>30_000){
    await p.members.markInterruptedTextRequestsUnknown();
    lastSweep=Date.now();
  }
  const job=await p.members.takeQueuedTextRequest();
  if(!job)return false;
  // The recovery sweep only marks requests unknown after their worker lease
  // stops advancing. A long but healthy provider stream must remain durable.
  let heartbeatInFlight=false;
  const heartbeat=setInterval(()=>{
    if(heartbeatInFlight)return;
    heartbeatInFlight=true;
    void p.members.heartbeatSubmittedTextRequest(job.id,job.userId)
      .catch(error=>{console.error('Text request lease heartbeat failed',job.id,error);})
      .finally(()=>{heartbeatInFlight=false;});
  },30_000);
  heartbeat.unref();
  let submitted=false;
  try{
    const vault=await modelVault();
    const request=textGenerationSchema.parse(JSON.parse(await vault.unsealText(job.requestBlob)));
    if(request.id!==job.id)throw new FlowError('MODEL_INPUT','模型任务编号与保存的请求不一致');
    const config=await vault.get();
    submitted=true;
    const result=await complete(config,request,undefined,delta=>publishTextDelta(job.id,delta));
    await p.members.finishModelRequest(job.id,job.userId,result);
    finishTextStream(job.id,{text:result.text});
  }catch(error){
    const uncertain=submitted&&(!FlowError.is(error)||error.retryable||['NETWORK_TIMEOUT','NETWORK_ERROR','DNS_TIMEOUT'].includes(error.code));
    const status=uncertain?'unknown':'failed';
    const unavailable=!uncertain&&FlowError.is(error)&&error.code==='PROVIDER_UNAVAILABLE';
    const result={code:uncertain?'MODEL_REQUEST_UNCERTAIN':unavailable?'PROVIDER_UNAVAILABLE':'MODEL_REQUEST_FAILED',safeToFailover:unavailable,
      message:uncertain?'模型提交结果无法确认；不会重复提交':unavailable?'当前模型连接明确未受理请求，可尝试下一供应商':'模型请求失败，请检查模型配置或稍后创建新任务'};
    await p.members.finishModelRequest(job.id,job.userId,result,status);
    finishTextStream(job.id,{message:result.message,code:result.code,safeToFailover:result.safeToFailover});
  }finally{
    clearInterval(heartbeat);
  }
  return true;
}

const worker=globalThis as typeof globalThis&{lingfengTextWorkerStarted?:boolean};
export function startModelWorker(){
  if(worker.lingfengTextWorkerStarted)return;
  worker.lingfengTextWorkerStarted=true;
  const tick=async()=>{
    let worked=false;
    try{worked=await processNextTextRequest();}
    catch{ /* The queued row stays durable; the next tick reopens the store. */ }
    setTimeout(tick,worked?0:1_000).unref();
  };
  setTimeout(tick,0).unref();
}
