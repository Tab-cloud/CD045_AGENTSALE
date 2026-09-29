// Reads only the explicitly isolated QA profile; never exports credentials.
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const base='http://127.0.0.1:3046',dir=path.resolve('docs/reports/artifacts/automation-v0.2');
const login=await fetch(base+'/api/v1/auth',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({action:'login',username:'qa-operator',password:'TestOnly-Operator-20260906'})});
if(!login.ok)throw new Error('Isolated QA login failed');
const Cookie=login.headers.get('set-cookie').split(';')[0];
const response=await fetch(base+'/api/v1/automation',{headers:{Cookie}}),data=await response.json();
const job=data.jobs.find(j=>j.kind==='render'&&j.copy?.title==='QA workflow · revised video');
if(!job||job.state!=='waiting_review'||job.reviewedBy)throw new Error('Expected revised QA video awaiting fresh review');
await mkdir(dir,{recursive:true});const files=[];
for(const artifact of job.artifacts){const url=base+'/api/v1/files?'+new URLSearchParams({job:job.id,name:artifact.name});const r=await fetch(url,{headers:{Cookie}});if(!r.ok)throw new Error('QA artifact download failed');const bytes=Buffer.from(await r.arrayBuffer()),hash=createHash('sha256').update(bytes).digest('hex');if(hash!==artifact.hash)throw new Error('Artifact digest mismatch');const name='qa-'+artifact.name;await writeFile(path.join(dir,name),bytes);files.push({name,bytes:bytes.length,sha256:hash});}
const videoUrl=base+'/api/v1/files?'+new URLSearchParams({job:job.id,name:'video.mp4'});
const range=await fetch(videoUrl,{headers:{Cookie,Range:'bytes=0-99'}}),anonymous=await fetch(videoUrl);if(range.status!==206||anonymous.status!==401)throw new Error('Media access/range validation failed');
const record={environment:'isolated QA, synthetic asset and operator text; no live model used',jobId:job.id,state:job.state,steps:job.steps,files,rangeStatus:range.status,anonymousDownloadStatus:anonymous.status,createdAt:new Date().toISOString()};
await writeFile(path.join(dir,'video-workflow-check.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));
