// User-authorized live checks, bounded by the existing admin and job budgets.
// No credentials are printed or read from source files.
import { readFile,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const base='http://127.0.0.1:3046',mode=process.argv[2]||'status',dir='docs/reports/artifacts/content-v0.3';
async function loginAs(username,password){const r=await fetch(base+'/api/v1/auth',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({action:'login',username,password})});if(!r.ok)throw new Error('QA role login failed');return r.headers.get('set-cookie').split(';')[0];}
const Cookie=await loginAs(mode==='verify'?'qa-admin':'qa-operator',mode==='verify'?'TestOnly-Flow-20260906':'TestOnly-Operator-20260906');
async function post(route,body){const r=await fetch(base+route,{method:'POST',headers:{Cookie,Origin:base,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify(body)});return {status:r.status,...await r.json()};}
if(mode==='verify'){const result=await post('/api/v1/admin',{action:'verify'}),record={...result,at:new Date().toISOString(),endpoint:'https://api.minimaxi.com/v1',model:'MiniMax-M2.7',live:true};await writeFile(dir+'/live-minimax-text.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));}
else if(mode==='create'){
  const snapshot=await (await fetch(base+'/api/v1/state',{headers:{Cookie}})).json(),data=await (await fetch(base+'/api/v1/automation',{headers:{Cookie}})).json(),p=snapshot.products.find(p=>p.name==='QA Content Kit · Synthetic');
  const result=await post('/api/v1/automation',{action:'create',input:{kind:'content',productId:p.id,expectedVersion:p.version,assetId:data.assets.find(a=>a.productId===p.id).id,query:'软件验收使用的合成商品资料，只生成明确待审阅的测试内容，不代表真实供应商推荐。',videoMode:'minimax',voiceover:true,budgetCents:80}});
  if(result.status!==200)throw new Error(result.message);await writeFile(dir+'/live-job.json',JSON.stringify({jobId:result.job.id,createdAt:new Date().toISOString(),scope:'one synthetic product content bundle, live MiniMax text/speech/video',budgetCents:80},null,2));console.log(JSON.stringify({jobId:result.job.id}));
}else{const {jobId}=JSON.parse(await readFile(dir+'/live-job.json','utf8')),data=await (await fetch(base+'/api/v1/automation',{headers:{Cookie}})).json(),j=data.jobs.find(j=>j.id===jobId);const record={jobId,state:j.state,error:j.error,steps:j.steps,remoteVideo:j.remoteVideo,files:j.artifacts.map(a=>({name:a.name,bytes:a.bytes,hash:a.hash})),at:new Date().toISOString()};await writeFile(dir+'/live-progress.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));}
