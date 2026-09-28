import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import * as auth from '../console/app/api/v1/auth/route';
import * as config from '../console/app/api/v1/admin/route';
import * as creative from '../console/app/api/v1/creative/route';
import * as creativeConfig from '../console/app/api/v1/creative-config/route';
import * as gateway from '../console/app/api/v1/gateway/route';
import * as billing from '../console/app/api/v1/membership-admin/route';
import * as dashboard from '../console/app/api/v1/dashboard/route';
import * as legacy from '../console/app/api/v1/automation/route';
import {getRepository} from '../console/lib/local-runtime';
const base='http://127.0.0.1:3045';let root:string,memberToken:string,adminToken:string;
const req=(service:string,token?:string,body?:unknown)=>new Request(base+'/api/v1/'+service,{method:body?'POST':'GET',headers:{Origin:base,...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
beforeAll(async()=>{root=await mkdtemp(path.join(tmpdir(),'lingfeng-access-'));process.env.AGENTSALE_LOCAL_DEMO='1';process.env.AGENTSALE_DATA_DIR=path.join(root,'pglite');process.env.LINGFENG_SETUP_TOKEN='fixture-bootstrap-not-production';const a=await auth.POST(req('auth',undefined,{action:'setup',username:'adminfixture',password:'fixture-password-long',setupToken:process.env.LINGFENG_SETUP_TOKEN,desktop:true}));expect(a.status).toBe(200);adminToken=(await a.json()).token;const b=await auth.POST(req('auth',undefined,{action:'register',username:'memberfixture',password:'fixture-password-long',desktop:true}));expect(b.status).toBe(200);memberToken=(await b.json()).token;},30000);
afterAll(async()=>{await (await getRepository()).close();await rm(root,{recursive:true,force:true});});
it('rejects anonymous configuration and service endpoints',async()=>{for(const endpoint of [config,creativeConfig,creative,billing,dashboard])expect((await endpoint.GET(req('test'))).status).toBe(401);expect((await gateway.POST(req('gateway',undefined,{action:'preflight',kind:'research'}))).status).toBe(401);});
it('blocks non-admin settings and the legacy shared workspace',async()=>{for(const endpoint of [config,creativeConfig,billing,dashboard,legacy])expect((await endpoint.GET(req('test',memberToken))).status).toBe(403);expect((await config.GET(req('admin',adminToken))).status).toBe(200);const overview=await dashboard.GET(req('dashboard',adminToken));expect(overview.status).toBe(200);expect((await overview.json()).totals).toMatchObject({users:1,activeMembers:0});});
it('loads member accounts only through the paged administrator query',async()=>{
 const settings=await billing.GET(req('membership-admin',adminToken));
 expect(settings.status).toBe(200);
 expect(await settings.json()).not.toHaveProperty('users');
 const page=await billing.GET(req('membership-admin?scope=users&page=1&q=member',adminToken));
 expect(page.status).toBe(200);
 expect(await page.json()).toMatchObject({page:1,pageSize:20,total:1,users:[{username:'memberfixture'}]});
 expect((await billing.GET(req('membership-admin?scope=users&page=0',adminToken))).status).toBe(400);
});
it('blocks nonmember model, search, media before contacting providers',async()=>{for(const body of [{action:'preflight',kind:'research'},{action:'preflight',kind:'file_work'},{action:'complete',role:'coordinator',context:{}},{action:'search',query:'test'},{action:'fetch',url:'https://example.com'}])expect((await gateway.POST(req('gateway',memberToken,body))).status).toBe(403);expect((await creative.POST(req('creative',memberToken,{action:'start',id:randomUUID(),kind:'image',prompt:'test'}))).status).toBe(403);expect((await creative.GET(req('creative?asset='+randomUUID(),memberToken))).status).toBe(404);});
it('requires setup secret, prevents a second bootstrap, and keeps tokens out of browser JSON',async()=>{expect((await auth.POST(req('auth',undefined,{action:'setup',username:'anotheradmin',password:'fixture-password-long',setupToken:'wrong'}))).status).toBe(403);const response=await auth.POST(req('auth',undefined,{action:'login',username:'memberfixture',password:'fixture-password-long'}));expect(response.status).toBe(200);expect(await response.json()).not.toHaveProperty('token');expect(response.headers.get('set-cookie')).toContain('HttpOnly');});

it('requires login for webpage reading',async()=>{expect((await gateway.POST(req('gateway',undefined,{action:'fetch',url:'https://example.com'}))).status).toBe(401);});
it('shares server-enforced quota between search and reading, then honors revocation',async()=>{
 const {platform}=await import('../console/lib/platform');
 const p=await platform(),admin=await p.auth.require(adminToken,true);
 const result=await auth.POST(req('auth',undefined,{action:'register',username:'researchfixture',password:'fixture-password-long',desktop:true})),account=await result.json();
 const plan=await p.members.savePlan({id:'research-test',name:'测试检索',priceCents:1,days:1,published:true,limits:{model:6,search:2,image:0,video:0}},admin);
 const order=await p.members.createOrder(account.user,plan.id,'wechat');await p.members.settle(order.id,'wechat',1,'synthetic-test-transaction');
 const network=await import('../packages/automation/src/network'),providers=await import('../packages/automation/src/providers');
 const fetchSpy=vi.spyOn(network,'fetchSource').mockResolvedValue({id:'fixture',url:'https://example.com/final',title:'测试正文',text:'公开正文',hash:'test-hash',fetchedAt:new Date().toISOString(),status:'fetched'});
 const searchSpy=vi.spyOn(providers,'webSearch').mockResolvedValue([]);
 try{
  const page=await gateway.POST(req('gateway',account.token,{action:'fetch',url:'https://example.com/article'}));expect(page.status).toBe(200);expect((await page.json()).page).toMatchObject({text:'公开正文',url:'https://example.com/final',truncated:false});
  expect((await gateway.POST(req('gateway',account.token,{action:'search',query:'followup'}))).status).toBe(200);
  expect((await gateway.POST(req('gateway',account.token,{action:'fetch',url:'https://example.com/more'}))).status).toBe(429);expect(fetchSpy).toHaveBeenCalledTimes(1);expect(searchSpy).toHaveBeenCalledTimes(1);
  expect((await p.members.status(account.user.id)).usage).toContainEqual({feature:'search',used:2});
  await p.members.revoke(account.user.id,admin);
  expect((await gateway.POST(req('gateway',account.token,{action:'fetch',url:'https://example.com/more'}))).status).toBe(403);
 }finally{fetchSpy.mockRestore();searchSpy.mockRestore();}
});
it('knowledge endpoints enforce membership, ownership and daily quota without locking expired users out of stored files',async()=>{
 const kb=await import('../console/app/api/v1/knowledge/route');
 const call=(token:string|undefined,body:unknown)=>kb.POST(req('knowledge',token,body));
 expect((await call(undefined,{action:'list'})).status).toBe(401);
 expect((await call(memberToken,{action:'create',name:'未订阅的知识库'})).status).toBe(403);
 const {platform}=await import('../console/lib/platform');const p=await platform(),admin=await p.auth.require(adminToken,true);
 const login=await auth.POST(req('auth',undefined,{action:'register',username:'knowledgefixture',password:'fixture-password-long',desktop:true})),account=await login.json();
 await p.members.savePlan({id:'knowledge-test',name:'测试知识库',priceCents:1,days:1,published:true,limits:{model:3,search:1,image:0,video:0}},admin);
 const order=await p.members.createOrder(account.user,'knowledge-test','wechat');await p.members.settle(order.id,'wechat',1,'synthetic-knowledge-transaction');
 const created=await call(account.token,{action:'create',name:'用户知识库'});expect(created.status).toBe(200);const {id:libraryId}=await created.json();
 const imported=await call(account.token,{action:'import',libraryId,name:'资料.md',data:Buffer.from('聆风知识库检索验收资料。保修期限为十二个月。').toString('base64')});expect(imported.status).toBe(200);const {id:documentId}=await imported.json();
 expect((await call(memberToken,{action:'document',libraryId,documentId})).status).toBe(404);
 expect((await call(account.token,{action:'search',libraryId,query:'保修期限'})).status).toBe(200);
 expect((await call(account.token,{action:'search',libraryId,query:'保修期限'})).status).toBe(429);
 await p.members.revoke(account.user.id,admin);
 expect((await call(account.token,{action:'import',libraryId,name:'new.md',data:Buffer.from('new').toString('base64')})).status).toBe(403);
 const stored=await call(account.token,{action:'document',libraryId,documentId});expect(stored.status).toBe(200);expect((await stored.json()).document.text).toContain('十二个月');
 expect((await call(account.token,{action:'archiveDocument',libraryId,documentId,archived:true})).status).toBe(200);
});

it('ecommerce reference uploads require membership and invalid references do not consume image quota',async()=>{
 const photo=await (await import('sharp')).default({create:{width:16,height:16,channels:3,background:'#fff'}}).png().toBuffer();
 const data=photo.toString('base64');
 expect((await creative.POST(req('creative',undefined,{action:'reference',data}))).status).toBe(401);
 expect((await creative.POST(req('creative',memberToken,{action:'reference',data}))).status).toBe(403);
 const {platform}=await import('../console/lib/platform');const p=await platform(),admin=await p.auth.require(adminToken,true);
 const registered=await auth.POST(req('auth',undefined,{action:'register',username:'commercefixture',password:'fixture-password-long',desktop:true})),account=await registered.json();
 await p.members.savePlan({id:'commerce-test',name:'测试电商',priceCents:1,days:1,published:true,limits:{model:3,search:0,image:4,video:0}},admin);
 const order=await p.members.createOrder(account.user,'commerce-test','wechat');await p.members.settle(order.id,'wechat',1,'synthetic-commerce-transaction');
 expect((await gateway.POST(req('gateway',account.token,{action:'preflight',kind:'ecommerce'}))).status).toBe(200);
 expect((await gateway.POST(req('gateway',account.token,{action:'preflight',kind:'file_work'}))).status).toBe(200);
 const imported=await creative.POST(req('creative',account.token,{action:'reference',data}));expect(imported.status).toBe(200);expect((await imported.json()).id).toMatch(/^[a-f0-9-]{36}$/);
 const failed=await creative.POST(req('creative',account.token,{action:'start',id:randomUUID(),kind:'image',prompt:'test',referenceId:randomUUID()}));expect(failed.status).not.toBe(200);
 expect((await p.members.status(account.user.id)).usage.find((u:any)=>u.feature==='image')?.used||0).toBe(0);
 await p.members.revoke(account.user.id,admin);
 expect((await creative.POST(req('creative',account.token,{action:'reference',data}))).status).toBe(403);
});
