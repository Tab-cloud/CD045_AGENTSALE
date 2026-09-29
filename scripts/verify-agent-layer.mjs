// Explicit isolated QA verification. Never run against the normal workspace.
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const base='http://127.0.0.1:3046',headers={Origin:base,'Content-Type':'application/json'};
const login=await fetch(base+'/api/v1/auth',{method:'POST',headers,body:JSON.stringify({action:'login',username:'qa-operator',password:'TestOnly-Operator-20260906'})});if(!login.ok)throw new Error('QA operator login failed');const cookie=login.headers.get('set-cookie').split(';')[0];
async function chat(message){const response=await fetch(base+'/api/v1/agent',{method:'POST',headers:{...headers,Cookie:cookie},body:JSON.stringify({message})}),body=await response.json();if(!response.ok)throw new Error(body.message||'Agent QA failed');return body;}
await chat('/goal 自动分析中国供应商和海外市场数据，选择达到门槛的产品');await chat('/budget 2.00');await chat('/interval 30');const started=await chat('/start'),status=await chat('/status');
const snapshot=status.snapshot,executed=snapshot.state.lastAction.includes('自动完成内部审阅')||snapshot.state.lastError.includes('ASSET_CONNECTOR_REQUIRED');if(!executed)throw new Error('Agent did not route decision to execution boundary: '+JSON.stringify(snapshot.state));
if(snapshot.state.cycleBudgetCents!==200||snapshot.state.cycleIntervalSeconds!==1800||snapshot.messages.length<8)throw new Error('Agent configuration or history was not persisted');
const report={environment:'isolated QA profile on port 3046',status:snapshot.state.status,objective:snapshot.state.objective,cycleBudgetCents:snapshot.state.cycleBudgetCents,cycleIntervalSeconds:snapshot.state.cycleIntervalSeconds,lastAction:snapshot.state.lastAction,lastError:snapshot.state.lastError,reply:started.reply,messageCount:snapshot.messages.length,capabilities:snapshot.capabilities,pausedAfterVerification:true,verifiedAt:new Date().toISOString()};
await chat('/pause');
const directory=path.resolve('docs/reports/artifacts/agent-v0.6');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'http-check.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
