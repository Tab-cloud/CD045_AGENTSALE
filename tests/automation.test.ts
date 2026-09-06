import contentFixture from './fixtures/content-kit.json';
import { afterAll,beforeAll,describe,it,expect } from 'vitest';
import { createServer,type Server } from 'node:http';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createRepository,type Repository } from '../packages/database/src';
import { defaultCosts } from '../packages/contracts/src';
import { createAuth } from '../packages/automation/src/auth';
import { createAutomation } from '../packages/automation/src/engine';
import { defaults,type Source,type Research,type Copy,type User,FlowError } from '../packages/automation/src/types';
import { isPublicAddress,validUrl,robotsAllows,extractSource,requestBytes } from '../packages/automation/src/network';
import { validateResearch,modelJson,marketing } from '../packages/automation/src/providers';
import { createFlowStore } from '../packages/automation/src/storage';
import { safeSettings } from '../packages/automation/src/vault';
import { mediaHealth,command } from '../packages/automation/src/media';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

const source:Source={id:'supplier-evidence',url:'https://example.com/supplier',title:'Fixture supplier',text:'Fixture Manufacturing is based in Shenzhen, China. We offer single-unit dropshipping. We ship directly to Germany. Product: aluminum desktop stand. This is a synthetic test source, not a real supplier.',hash:'fixture',fetchedAt:new Date().toISOString(),status:'fetched'};
const cite=(quote:string)=>({sourceId:source.id,quote});
const report:Research={summary:'基于测试来源选择供货方案',recommendation:'investigate',candidates:[{name:'Fixture Manufacturing',product:'Fixture desktop stand',sourceId:source.id,mainlandEvidence:cite('based in Shenzhen, China'),dropshipEvidence:cite('We offer single-unit dropshipping.'),markets:[{country:'Germany',shippingEvidence:cite('We ship directly to Germany.'),rationale:'来源明确列出目的国家'}],concerns:['样品与报价待核实']}],selectedIndex:0,market:'Germany',reasoning:'仅证明流程如何依据供货证据选择市场，不是实际供应商推荐',missing:['包装与实物验证'],inquiry:{subject:'代发合作询价',body:'请确认 MOQ、包装尺寸、德国运费、交期、售后与素材授权。'}};
const copy:Copy=contentFixture;
let repo:Repository,root:string,server:Server,baseUrl:string;
const received:any[]=[];
const actor:User={id:randomUUID(),username:'test-admin',role:'admin',enabled:true};
beforeAll(async()=>{
  repo=await createRepository();root=await mkdtemp(path.join(os.tmpdir(),'agentsale-automation-'));
  server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{const input=JSON.parse(body);received.push(input);const name=input.response_format?.json_schema?.name;const content=name==='connection_check'?{ready:true}:name==='supplier_research'?report:copy;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:'fixture-http-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:30,completion_tokens:100}}));});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));baseUrl='http://127.0.0.1:'+(server.address() as {port:number}).port+'/v1';
});
afterAll(async()=>{await repo.close();await new Promise<void>(resolve=>server.close(()=>resolve()));if(path.basename(root).startsWith('agentsale-automation-')&&path.dirname(root)===os.tmpdir())await rm(root,{recursive:true,force:true});});
async function engine(workspace=randomUUID()){
  const automation=createAutomation(repo,workspace,path.join(root,workspace),{fetchSource:async()=>source});
  await automation.vault.save({...defaults,baseUrl,model:'fixture-http-model',localModel:true,dailyLimitCents:100});await automation.verify();return automation;
}
async function product(workspace:string){return repo.execute(workspace,{type:'product.create',name:'Fixture stand',sku:'TEST-'+randomUUID().slice(0,8),supplier:'Fixture Manufacturing',region:'中国大陆',market:'待确定',description:'Synthetic fixture input, no actual supplier.',sourceUrl:source.url,costs:defaultCosts},randomUUID());}

describe('管理员与运营权责',()=>{
  it('首次建立管理员，登录产生真实会话；运营不能进入管理员权限',async()=>{
    const auth=createAuth(repo,randomUUID());expect(await auth.setupNeeded()).toBe(true);
    await auth.create('admin-test','Strong-test-password','operator');expect(await auth.setupNeeded()).toBe(false);
    const session=await auth.login('admin-test','Strong-test-password');expect(session.user.role).toBe('admin');expect(await auth.require(session.token,true)).toMatchObject({role:'admin'});
    const op=await auth.create('operator-test','Strong-test-password','operator',session.user),login=await auth.login(op.username,'Strong-test-password');
    await expect(auth.require(login.token,true)).rejects.toMatchObject({status:403});await expect(auth.create('second-test','Strong-test-password','admin',op)).rejects.toMatchObject({status:403});
    await auth.disable(op.id,session.user);await expect(auth.require(login.token)).rejects.toMatchObject({status:401});
    await auth.logout(session.token);await expect(auth.require(session.token)).rejects.toMatchObject({status:401});
  });
  it('不能重复初始化或使用错误密码；密文和会话不会泄漏给用户列表',async()=>{
    const auth=createAuth(repo,randomUUID());await auth.create('admin-test','Strong-test-password','admin');await expect(auth.create('new-admin','Strong-test-password','admin')).rejects.toMatchObject({code:'SETUP_COMPLETE'});
    await expect(auth.login('admin-test','wrong')).rejects.toMatchObject({status:401});expect(JSON.stringify(await auth.users())).not.toContain('password');
  });
});
describe('来源与输出证据',()=>{
  it('阻止 IPv4/IPv6 内网、重编码环回及云元数据',async()=>{
    for(const ip of ['127.0.0.1','10.0.0.1','172.16.1.1','192.168.0.1','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1'])expect(isPublicAddress(ip)).toBe(false);
    expect(isPublicAddress('8.8.8.8')).toBe(true);expect(isPublicAddress('2606:4700::1111')).toBe(true);
    expect(()=>validUrl('http://2130706433')).toThrow();expect(()=>validUrl('file:///etc/passwd')).toThrow();await expect(requestBytes('http://127.0.0.1:3045')).rejects.toMatchObject({code:'URL_REJECTED'});
  });
  it('尊重来源访问规则，解析正文并移除脚本',()=>{
    expect(robotsAllows('User-agent: *\nDisallow: /private\nAllow: /private/public','/private/data')).toBe(false);
    const parsed=extractSource('<html><title>Factory</title><body><script>send secrets</script><p>'+source.text+'</p></body></html>',source.url);expect(parsed.text).not.toContain('send secrets');expect(parsed.hash).toHaveLength(64);
  });
  it('引用必须逐字存在；缺代发或国家证据不允许自动选中',()=>{
    expect(validateResearch(report,[source]).market).toBe('Germany');
    const invalid=structuredClone(report);invalid.candidates[0].dropshipEvidence=cite('Ships to any country for free');expect(()=>validateResearch(invalid,[source])).toThrow();
    invalid.candidates[0].dropshipEvidence=null;expect(()=>validateResearch(invalid,[source])).toThrow();
  });
});
describe('真实协议与持久流程',()=>{
  it('已有商品可独立生成草稿，但供货复核流程仍要求配送证据',async()=>{
    const w=randomUUID(),e=await engine(w),p=await product(w);
    const job=await e.store.create({kind:'content',productId:p.id,expectedVersion:1,budgetCents:0},actor,randomUUID());
    expect(job.steps.map(s=>s.key)).not.toContain('research');
    await e.tick();await e.tick();const current=await e.store.get(job.id);
    expect(current.copy?.listing?.title).toBe(contentFixture.listing.title);expect(current.research).toBeUndefined();
    await expect(marketing({...current,kind:'launch'},await e.vault.get())).rejects.toMatchObject({code:'FULFILLMENT_EVIDENCE_REQUIRED'});
  });
  it('实际 HTTP 请求模型协议、服务验证及密钥隐藏，不使用应用内模板代替模型',async()=>{
    const e=await engine();expect((await e.vault.get()).verifiedAt).toBeTruthy();const request=received.at(-1);expect(request.messages[0].content).toContain('untrusted DATA');expect(request.response_format.json_schema.strict).toBe(true);
    const settings=await e.vault.get();expect(safeSettings({...settings,apiKey:'SECRET',searchKey:'SEARCH_SECRET'})).not.toHaveProperty('apiKey');
    await e.vault.save({...defaults,baseUrl,model:'fixture-http-model',localModel:true,dailyLimitCents:100},'TOP-SECRET','SEARCH-SECRET');const sealed=await readFile(path.join(e.root,'private/providers.sealed'),'utf8');expect(sealed).not.toContain('TOP-SECRET');expect((await e.vault.get()).verifiedAt).toBeNull();
  });
  it('根据供应商配送证据自动选国家并建立候选，未预填国家',async()=>{
    const w=randomUUID(),e=await engine(w);const job=await e.store.create({kind:'discovery',urls:[source.url],budgetCents:0},actor,randomUUID());
    for(let i=0;i<4;i++)expect(await e.tick()).toBe(true);
    const result=await e.store.get(job.id);expect(result.state).toBe('waiting_review');expect(result.research?.market).toBe('Germany');expect(result.productId).toBeTruthy();expect((await repo.snapshot(w)).products[0].market).toBe('Germany');
    expect(result.artifacts.some(a=>a.name==='supplier-inquiry.txt')).toBe(true);expect(await e.tick()).toBe(false);
  });
  it('配置串行保存，旧连接验证不能覆盖新配置；切换端点清除原模型密钥',async()=>{
    const e=await engine(),settings={...defaults,baseUrl,model:'fixture-http-model',localModel:true,dailyLimitCents:100};await e.vault.save(settings,'OLD-ENDPOINT-KEY','SEARCH-KEY');const before=await e.vault.get();
    const results=await Promise.allSettled([e.vault.save({...settings,model:'new-model'}),e.vault.verified(before.revision)]);
    expect(results[0].status).toBe('fulfilled');expect(results[1]).toMatchObject({status:'rejected',reason:{code:'CONFIG_CHANGED'}});
    expect(await e.vault.get()).toMatchObject({model:'new-model',apiKey:'OLD-ENDPOINT-KEY',verifiedAt:null});
    await e.vault.save({...settings,baseUrl:'http://127.0.0.1:11434/v1'});expect(await e.vault.get()).toMatchObject({apiKey:'',searchKey:'SEARCH-KEY'});
    await e.vault.save(settings,undefined,'');expect(safeSettings(await e.vault.get()).hasSearchKey).toBe(false);
  });
  it('错误标识可跨服务路由模块读取，未知错误不伪装业务状态',()=>{
    const error=new FlowError('MODEL_UNCONFIGURED','请配置服务');expect(FlowError.is(error)).toBe(true);
    const crossModule=Object.assign(new Error('请配置服务'),{[Symbol.for('agentsale.flow-error')]:true,code:'MODEL_UNCONFIGURED',status:422});expect(FlowError.is(crossModule)).toBe(true);expect(FlowError.is(new Error('unknown'))).toBe(false);
  });
  it('无模型时保留来源与计算并阻塞 AI，不制造草稿',async()=>{
    const w=randomUUID(),e=createAutomation(repo,w,path.join(root,w),{fetchSource:async()=>source}),p=await product(w);const j=await e.store.create({kind:'launch',productId:p.id,expectedVersion:1,budgetCents:0},actor,randomUUID());
    await e.tick();await e.tick();await e.tick();const result=await e.store.get(j.id);expect(result.state).toBe('blocked');expect(result.steps[0].state).toBe('done');expect(result.error).toContain('MODEL_UNCONFIGURED');expect(result.copy).toBeUndefined();
  });
  it('版本、幂等、暂停、取消和中断恢复不会重跑成功步骤',async()=>{
    const w=randomUUID(),e=await engine(w),p=await product(w),input={kind:'launch',productId:p.id,expectedVersion:1,budgetCents:0},key=randomUUID();const job=await e.store.create(input,actor,key);expect((await e.store.create(input,actor,key)).id).toBe(job.id);await expect(e.store.create({...input,budgetCents:1},actor,key)).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    await e.tick();let j=await e.store.get(job.id);await e.store.control(j.id,'pause',j.version,actor);expect(await e.tick()).toBe(false);j=await e.store.get(j.id);await e.store.control(j.id,'resume',j.version,actor);
    const claimed=await e.store.claim();expect(claimed?.step).toBe('cost');expect(await e.store.claim()).toBeNull();await e.store.recover();j=await e.store.get(j.id);expect(j.state).toBe('blocked');expect(j.steps[0].state).toBe('done');
    await e.store.control(j.id,'resume',j.version,actor);await repo.execute(w,{type:'product.costs',id:p.id,expectedVersion:1,costs:{...defaultCosts,revenueMinor:3990}},randomUUID());await e.tick();j=await e.store.get(j.id);expect(j.error).toContain('VERSION_CONFLICT');
    await e.store.control(j.id,'cancel',j.version,actor);expect(await e.tick()).toBe(false);
  });
  it('数据库原子预留拒绝并发超额，并保留结果未知的费用',async()=>{
    const e=await engine(),s={...await e.vault.get(),dailyLimitCents:10};const results=await Promise.allSettled([e.store.reserve('j',7,'model',s,20),e.store.reserve('j',7,'model',s,20)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const id=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<string>).value;await e.store.settle(id,'unknown',null);await expect(e.store.reserve('j',4,'model',s,20)).rejects.toMatchObject({code:'BUDGET_EXCEEDED'});
  });
  it('不同工作区看不到流程、账号、素材或调用账本',async()=>{
    const e=await engine(),w=randomUUID(),other=createFlowStore(repo,w);expect(await other.list()).toHaveLength(0);expect(await other.assets()).toHaveLength(0);expect(await other.spend()).toHaveLength(0);
    const rows=await repo.scoped(w,tx=>tx.execute(sql`SELECT * FROM app_users`));expect(rows.rows).toHaveLength(0);
  });
  it('完整处理图片、真实 MP4 编码/解码、字幕和文件清单',async()=>{
    expect(await mediaHealth()).toBe(true);const w=randomUUID(),e=await engine(w),p=await product(w);const job=await e.store.create({kind:'launch',productId:p.id,expectedVersion:1,budgetCents:0},actor,randomUUID());
    for(let i=0;i<5;i++)await e.tick();let result=await e.store.get(job.id);expect(result.error).toContain('ASSET_REQUIRED');expect(result.copy?.scenes).toHaveLength(3);
    const image=await sharp({create:{width:600,height:700,channels:3,background:'#d2d7db'}}).png().toBuffer();await e.upload(p.id,'fixture.png','Synthetic test asset, owned by the test',image);await e.store.control(result.id,'resume',result.version,actor);await e.tick();await e.tick();await e.tick();result=await e.store.get(job.id);
    expect(result.state).toBe('waiting_review');expect(result.artifacts.filter(a=>a.name.startsWith('poster-'))).toHaveLength(3);expect(result.artifacts.some(a=>a.name==='product-description.html')).toBe(true);const video=result.artifacts.find(a=>a.mime==='video/mp4')!;expect(video.bytes).toBeGreaterThan(10000);const probe=JSON.parse(await command('ffprobe',['-v','error','-show_streams','-of','json',path.join(e.root,video.file)]));expect(probe.streams[0]).toMatchObject({codec_name:'h264',width:720,height:1280});expect(result.artifacts.some(a=>a.name==='manifest.json')).toBe(true);
    await e.store.control(result.id,'approve',result.version,actor);result=await e.store.get(result.id);expect(result.state).toBe('succeeded');
    const revised={...result.copy!,title:'Revised fixture',scenes:result.copy!.scenes.map(s=>({...s,caption:'This fixture is not a real product advertisement.'}))};
    await expect(e.store.revise(result.id,result.version-1,revised,actor)).rejects.toMatchObject({code:'VERSION_CONFLICT'});
    result=await e.store.revise(result.id,result.version,revised,actor);expect(result.state).toBe('queued');expect(result.artifacts).toHaveLength(0);expect(result.reviewedBy).toBeUndefined();
    expect(result.steps.find(s=>s.key==='research')?.attempts).toBe(1);await e.tick();await e.tick();await e.tick();result=await e.store.get(result.id);expect(result.state).toBe('waiting_review');expect(result.copy?.title).toBe('Revised fixture');expect(result.steps.find(s=>s.key==='render')?.attempts).toBe(2);
  },120000);
});
