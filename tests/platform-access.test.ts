import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import * as auth from '../console/app/api/v1/auth/route';
import * as config from '../console/app/api/v1/admin/route';
import * as creativeConfig from '../console/app/api/v1/model-media-config/route';
import * as models from '../console/app/api/v1/models/route';
import * as billing from '../console/app/api/v1/membership-admin/route';
import * as dashboard from '../console/app/api/v1/dashboard/route';
import {getRepository} from '../console/lib/local-runtime';
const base='http://127.0.0.1:3045';let root:string,memberToken:string,adminToken:string;
const req=(service:string,token?:string,body?:unknown)=>new Request(base+'/api/v1/'+service,{method:body?'POST':'GET',headers:{Origin:base,...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
beforeAll(async()=>{root=await mkdtemp(path.join(tmpdir(),'lingfeng-access-'));process.env.AGENTSALE_LOCAL_DEMO='1';process.env.AGENTSALE_DATA_DIR=path.join(root,'pglite');process.env.LINGFENG_SETUP_TOKEN='fixture-bootstrap-not-production';const a=await auth.POST(req('auth',undefined,{action:'setup',username:'adminfixture',password:'fixture-password-long',setupToken:process.env.LINGFENG_SETUP_TOKEN,desktop:true}));expect(a.status).toBe(200);adminToken=(await a.json()).token;const b=await auth.POST(req('auth',undefined,{action:'register',username:'memberfixture',password:'fixture-password-long',desktop:true}));expect(b.status).toBe(200);memberToken=(await b.json()).token;},30000);
afterAll(async()=>{await (await getRepository()).close();await rm(root,{recursive:true,force:true});});
it('rejects anonymous configuration and service endpoints',async()=>{for(const endpoint of [config,creativeConfig,billing,dashboard,models])expect((await endpoint.GET(req('test'))).status).toBe(401);expect((await models.POST(req('models',undefined,{action:'text.generate',id:randomUUID(),messages:[{role:'user',content:'test'}]}))).status).toBe(401);});
it('rejects excess model input before reserving member usage',async()=>{
 const {platform}=await import('../console/lib/platform');const {concurrencyGate}=await import('../console/lib/concurrency');
 const p=await platform(),member=await p.auth.require(memberToken),before=(await p.members.status(member.id)).usage;
 const first=concurrencyGate.tryAcquire('modelInput',member.id),second=concurrencyGate.tryAcquire('modelInput',member.id);
 expect(first&&second).toBeTruthy();
 try{
  const response=await models.POST(req('models',memberToken,{action:'text.generate',id:randomUUID(),messages:[{role:'user',content:'test'}]}));
  expect(response.status).toBe(429);expect(await response.json()).toMatchObject({code:'SERVICE_BUSY'});
  expect((await p.members.status(member.id)).usage).toEqual(before);
 }finally{first?.();second?.();}
});
it('blocks non-admin settings and the legacy shared workspace',async()=>{for(const endpoint of [config,creativeConfig,billing,dashboard])expect((await endpoint.GET(req('test',memberToken))).status).toBe(403);expect((await config.POST(req('admin',memberToken,{action:'listVoices',providerId:'standard'}))).status).toBe(403);expect((await config.POST(req('admin',undefined,{action:'listVoices',providerId:'standard'}))).status).toBe(401);const speech={action:'testSpeech',providerId:'standard',voiceId:'Chinese (Mandarin)_Reliable_Executive',text:'测试'};expect((await config.POST(req('admin',memberToken,speech))).status).toBe(403);expect((await config.POST(req('admin',undefined,speech))).status).toBe(401);expect((await config.GET(req('admin',adminToken))).status).toBe(200);const overview=await dashboard.GET(req('dashboard',adminToken));expect(overview.status).toBe(200);expect((await overview.json()).totals).toMatchObject({users:1,activeMembers:0});});
it('validates the administrator speech test before contacting a provider',async()=>{
 expect((await config.POST(req('admin',adminToken,{action:'testSpeech',providerId:'standard',voiceId:'x',text:'a'.repeat(201)}))).status).toBe(400);
 const response=await config.POST(req('admin',adminToken,{action:'testSpeech',providerId:'standard',voiceId:'Chinese (Mandarin)_Reliable_Executive',text:'测试'}));
 expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'PROVIDER_UNAVAILABLE'});
});
it('loads member accounts only through the paged administrator query',async()=>{
 const settings=await billing.GET(req('membership-admin',adminToken));
 expect(settings.status).toBe(200);
 expect(await settings.json()).not.toHaveProperty('users');
 const page=await billing.GET(req('membership-admin?scope=users&page=1&q=member',adminToken));
 expect(page.status).toBe(200);
 expect(await page.json()).toMatchObject({page:1,pageSize:20,total:1,users:[{username:'memberfixture'}]});
 expect((await billing.GET(req('membership-admin?scope=users&page=0',adminToken))).status).toBe(400);
});
it('round-trips enabled Alipay settings through the admin save and reload API without returning key contents',async()=>{
 const {platform}=await import('../console/lib/platform');
 const before=await (await platform()).payments.configuration();
 const clean=(channel:typeof before.alipay)=>{const {hasPrivateKey:_,hasPublicKey:__,hasApiV3Key:___,...value}=channel;return value;};
 const appKeys=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 const providerKeys=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 const config={publicUrl:'https://members.example.com',wechat:clean(before.wechat),alipay:{...clean(before.alipay),enabled:true,appId:'alipay-fixture',merchantId:'seller-fixture',privateKey:appKeys.privateKey,publicKey:providerKeys.publicKey}};
 const saved=await billing.POST(req('membership-admin',adminToken,{action:'payment',revision:before.revision,config}));
 expect(saved.status).toBe(200);
 const reloaded=await billing.GET(req('membership-admin',adminToken));
 expect(reloaded.status).toBe(200);
 const payment=(await reloaded.json()).payment;
 expect(payment.alipay).toMatchObject({enabled:true,appId:'alipay-fixture',merchantId:'seller-fixture',privateKey:'',publicKey:'',hasPrivateKey:true,hasPublicKey:true});
 expect(JSON.stringify(payment)).not.toContain(appKeys.privateKey);
 expect(JSON.stringify(payment)).not.toContain(providerKeys.publicKey);
});
it('requires setup secret, prevents a second bootstrap, and keeps tokens out of browser JSON',async()=>{expect((await auth.POST(req('auth',undefined,{action:'setup',username:'anotheradmin',password:'fixture-password-long',setupToken:'wrong'}))).status).toBe(403);const response=await auth.POST(req('auth',undefined,{action:'login',username:'memberfixture',password:'fixture-password-long'}));expect(response.status).toBe(200);expect(await response.json()).not.toHaveProperty('token');expect(response.headers.get('set-cookie')).toContain('HttpOnly');});

it('reserves model quota exactly once for a request ID and rejects conflicting content',async()=>{
 const {platform}=await import('../console/lib/platform');const p=await platform(),admin=await p.auth.require(adminToken,true);
 const login=await auth.POST(req('auth',undefined,{action:'register',username:'modelfixture',password:'fixture-password-long',desktop:true})),account=await login.json();
 await p.members.savePlan({id:'model-idempotency-test',name:'模型请求测试',priceCents:1,days:1,published:true,limits:{model:1,image:0,video:0}},admin);
 const order=await p.members.createOrder(account.user,'model-idempotency-test','wechat');await p.members.settle(order.id,'wechat',1,'synthetic-model-transaction');
 const id=randomUUID(),first=await p.members.claimModelRequest(id,account.user.id,'hash-a');expect(first.created).toBe(true);
 expect(await p.members.claimModelRequest(id,account.user.id,'hash-a')).toMatchObject({created:false,status:'submitting'});
 await expect(p.members.claimModelRequest(id,account.user.id,'hash-b')).rejects.toMatchObject({code:'MODEL_REQUEST_CONFLICT'});
 await p.members.finishModelRequest(id,account.user.id,{text:'完成',model:'fixture',usage:null});
 expect(await p.members.claimModelRequest(id,account.user.id,'hash-a')).toMatchObject({created:false,status:'completed',result:{text:'完成'}});
 await expect(p.members.claimModelRequest(randomUUID(),account.user.id,'hash-c')).rejects.toMatchObject({code:'QUOTA_EXCEEDED'});
 expect((await p.members.status(account.user.id)).usage).toContainEqual({feature:'model',used:1});
});
it('does not consume the only daily allowance when an upstream explicitly rejects an attempt',async()=>{
 const {platform}=await import('../console/lib/platform');const p=await platform(),admin=await p.auth.require(adminToken,true);
 const login=await auth.POST(req('auth',undefined,{action:'register',username:'fallbackfixture',password:'fixture-password-long',desktop:true})),account=await login.json();
 await p.members.savePlan({id:'fallback-quota-test',name:'故障切换额度',priceCents:1,days:1,published:true,limits:{model:1,image:0,video:0}},admin);
 const order=await p.members.createOrder(account.user,'fallback-quota-test','wechat');await p.members.settle(order.id,'wechat',1,'synthetic-fallback-quota');
 const first=randomUUID(),second=randomUUID();
 expect((await p.members.claimModelRequest(first,account.user.id,'first')).created).toBe(true);
 await p.members.finishModelRequest(first,account.user.id,{code:'PROVIDER_UNAVAILABLE',safeToFailover:true,message:'明确未受理'},'failed');
 expect((await p.members.status(account.user.id)).usage.find((item:any)=>item.feature==='model')).toBeUndefined();
 expect((await p.members.claimModelRequest(second,account.user.id,'second')).created).toBe(true);
 expect((await p.members.status(account.user.id)).usage).toContainEqual({feature:'model',used:1});
});
it('relays each supplier text chunk before completion and keeps the final result by request ID',async()=>{
 const {platform}=await import('../console/lib/platform');const {modelVault}=await import('../console/lib/local-runtime');
 const p=await platform(),admin=await p.auth.require(adminToken,true);
 const login=await auth.POST(req('auth',undefined,{action:'register',username:'asyncmodel',password:'fixture-password-long',desktop:true})),account=await login.json();
 await p.members.savePlan({id:'async-model-test',name:'异步模型测试',priceCents:1,days:1,published:true,limits:{model:1,image:0,video:0}},admin);
 const order=await p.members.createOrder(account.user,'async-model-test','wechat');await p.members.settle(order.id,'wechat',1,'synthetic-async-model');
 let calls=0,releaseLastChunk=()=>{};
 const lastChunk=new Promise<void>(resolve=>{releaseLastChunk=resolve;});
 const upstream=createServer(async(_request,response)=>{
  calls++;response.setHeader('Content-Type','text/event-stream');
  await new Promise(resolve=>setTimeout(resolve,80));
  response.write('data: '+JSON.stringify({choices:[{delta:{content:'可取回的'},finish_reason:null}],model:'fixture'})+'\n\n');
  await lastChunk;
  response.end('data: '+JSON.stringify({choices:[{delta:{content:'测试结果'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
 });
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 try{
  const address=upstream.address();if(!address||typeof address==='string')throw new Error('fixture server address');
  const vault=await modelVault(),before=await vault.get();
  const {apiKey:_,minimaxKey:__,aggregateKey:___,verifiedAt:____,revision:_____,...settings}=before;
  await vault.save({...settings,baseUrl:`http://127.0.0.1:${address.port}/v1`,model:'fixture',localModel:true,format:'json_schema',protocol:'openai'},'',undefined,undefined,before.revision);
  const id=randomUUID(),input={action:'text.generate',providerId:'standard',id,messages:[{role:'user',content:'请返回结果'}]};
  const submitted=await models.POST(req('models',account.token,input));
  expect(submitted.status).toBe(200);expect(await submitted.json()).toMatchObject({id,status:'processing'});
  const result=await models.GET(req('models?request='+id,account.token));
  expect(result.status).toBe(200);expect(result.headers.get('content-type')).toContain('text/event-stream');
  const reader=result.body!.getReader(),decoder=new TextDecoder();
  let events='';
  while(!events.includes('event: delta')){
   const chunk=await reader.read();expect(chunk.done).toBe(false);events+=decoder.decode(chunk.value,{stream:true});
  }
  expect(events).toContain('可取回的');
  expect(events).not.toContain('event: completed');
  await reader.cancel();
  const resumed=await models.GET(req('models?request='+id,account.token));
  const resumedReader=resumed.body!.getReader();
  let resumedEvents='';
  while(!resumedEvents.includes('event: snapshot')){
   const chunk=await resumedReader.read();expect(chunk.done).toBe(false);resumedEvents+=decoder.decode(chunk.value,{stream:true});
  }
  expect(resumedEvents).toContain('可取回的');
  releaseLastChunk();
  while(true){const chunk=await resumedReader.read();if(chunk.done)break;resumedEvents+=decoder.decode(chunk.value,{stream:true});}
  expect(resumedEvents).toContain('event: completed');expect(resumedEvents).toContain('可取回的测试结果');
  const replay=await models.GET(req('models?request='+id,account.token));
  expect(await replay.text()).toContain('可取回的测试结果');
  expect((await models.POST(req('models',account.token,input))).status).toBe(200);
  expect(calls).toBe(1);
  expect((await p.members.status(account.user.id)).usage).toContainEqual({feature:'model',used:1});
 }finally{releaseLastChunk();upstream.close();}
},15000);
it('delivers a completed model file only to its owner',async()=>{
 const {platform}=await import('../console/lib/platform');const {storeModelFile}=await import('../console/lib/model-files');const {concurrencyGate}=await import('../console/lib/concurrency');
 const p=await platform(),admin=await p.auth.require(adminToken,true);
 const login=await auth.POST(req('auth',undefined,{action:'register',username:'imagefilefixture',password:'fixture-password-long',desktop:true})),account=await login.json();
 await p.members.savePlan({id:'model-file-test',name:'模型文件测试',priceCents:1,days:1,published:true,limits:{model:0,image:1,video:0}},admin);
 const order=await p.members.createOrder(account.user,'model-file-test','wechat');await p.members.settle(order.id,'wechat',1,'synthetic-model-file-transaction');
 const id=randomUUID();await p.members.claimModelRequest(id,account.user.id,'image-hash','image.generate');
 const bytes=Buffer.from(' {"data":[{"b64_json":"fixture"}]}\n');
 await storeModelFile(account.user.id,id,'application/json',bytes);
 await p.members.finishModelRequest(id,account.user.id,{id,status:'completed',mime:'application/json',model:'fixture'});
 const response=await models.GET(req('models?asset='+id,account.token));expect(response.status).toBe(200);expect(response.headers.get('content-type')).toBe('application/json');expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
 expect((await models.GET(req('models?asset='+id,memberToken))).status).toBe(404);
 const first=concurrencyGate.tryAcquire('asset','other-a'),second=concurrencyGate.tryAcquire('asset','other-b');
 expect(first&&second).toBeTruthy();
 try{const busy=await models.GET(req('models?asset='+id,account.token));expect(busy.status).toBe(429);expect(busy.headers.get('Retry-After')).toBe('5');}
 finally{first?.();second?.();}
});
