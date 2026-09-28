import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createRepository,type Repository} from '../packages/database/src/index';
import {createAuth} from '../packages/automation/src/auth';
import {createMembership} from '../packages/automation/src/membership';
import {createAuthServices} from '../console/lib/auth-services';
let repo:Repository;let root:string;
beforeAll(async()=>{repo=await createRepository();root=await mkdtemp(path.join(tmpdir(),'lingfeng-auth-services-'));},30000);
afterAll(async()=>{await repo?.close();await rm(root,{recursive:true,force:true});});
describe('phone registration and WeChat account binding',()=>{
  it('requires a delivered one-time code, limits retries, and keeps membership on the same user',async()=>{
    const workspace=randomUUID(),auth=createAuth(repo,workspace),members=createMembership(repo,workspace),admin=await auth.create('owner','very-long-password','admin'),services=createAuthServices(root),phone='13800138000',hash=services.codeHash;let delivered='';
    await auth.requestPhoneCode(phone,'register','source-one',async(_phone,code)=>{delivered=code;},hash);
    await expect(auth.requestPhoneCode(phone,'register','source-one',async()=>{},hash)).rejects.toThrow('60 秒');
    await expect(auth.registerPhone(phone,'000000'===delivered?'000001':'000000','very-long-password',hash)).rejects.toThrow('验证码');
    const result=await auth.registerPhone(phone,delivered,'very-long-password',hash);
    expect(result.user).toMatchObject({username:phone,phone,role:'operator'});
    await expect(auth.registerPhone(phone,delivered,'very-long-password',hash)).rejects.toThrow('已注册');
    const plan={id:'standard',name:'会员',priceCents:100,days:30,published:true,limits:{model:1,search:1,image:0,video:0}};
    await members.savePlan(plan,admin);const order=await members.createOrder(result.user,'standard','alipay');await members.settle(order.id,'alipay',100,'provider-transaction');
    const state=await auth.beginWechat('bind',result.user.id);expect(await auth.consumeWechat(state)).toMatchObject({userId:result.user.id,purpose:'bind'});await expect(auth.consumeWechat(state)).rejects.toThrow('失效');
    const linked=await auth.bindWechat(result.user.id,'wx1234567890abcdef','verified-openid');expect(linked.user.wechatBound).toBe(true);
    const viaWechat=await auth.loginWechat('wx1234567890abcdef','verified-openid');expect(viaWechat.user.id).toBe(result.user.id);expect((await members.status(viaWechat.user.id)).active).toBe(true);
    await expect(auth.bindWechat(admin.id,'wx1234567890abcdef','verified-openid')).rejects.toThrow('其他');
  });
  it('shows a paginated administrator bill ledger with paid and pending orders',async()=>{
    const workspace=randomUUID(),auth=createAuth(repo,workspace),members=createMembership(repo,workspace),admin=await auth.create('owner','very-long-password','admin'),member=await auth.register('member','very-long-password');
    await members.savePlan({id:'standard',name:'会员',priceCents:300,days:30,published:true,limits:{model:1,search:0,image:0,video:0}},admin);
    const paid=await members.createOrder(member,'standard','wechat');await members.settle(paid.id,'wechat',300,'provider-transaction');await members.createOrder(member,'standard','alipay');
    expect((await members.ordersPage(admin,1,'', 'all')).total).toBe(2);
    expect((await members.ordersPage(admin,1,paid.id,'paid')).orders[0]).toMatchObject({id:paid.id,username:'member',status:'paid'});
    expect((await members.ordersPage(admin,1,'','pending')).total).toBe(1);
    await expect(members.ordersPage(member,1,'','all')).rejects.toThrow('管理员');
  });
  it('locks a phone verification challenge after five wrong guesses',async()=>{
    const workspace=randomUUID(),auth=createAuth(repo,workspace),services=createAuthServices(path.join(root,'attempt-limit')),phone='13900139000';await auth.create('owner','very-long-password','admin');let delivered='';
    await auth.requestPhoneCode(phone,'register','source-two',async(_phone,code)=>{delivered=code;},services.codeHash);
    const wrong=delivered==='999999'?'888888':'999999';
    for(let attempt=0;attempt<5;attempt++)await expect(auth.registerPhone(phone,wrong,'very-long-password',services.codeHash)).rejects.toThrow('验证码');
    await expect(auth.registerPhone(phone,delivered,'very-long-password',services.codeHash)).rejects.toThrow('验证码');
  });
  it('allows an existing account to bind a verified phone without changing its identity',async()=>{
    const workspace=randomUUID(),auth=createAuth(repo,workspace),services=createAuthServices(path.join(root,'phone-bind')),phone='13700137000';await auth.create('owner','very-long-password','admin');const user=await auth.register('legacy-user','very-long-password');let code='';await auth.requestPhoneCode(phone,'bind','source-three',async(_phone,value)=>{code=value;},services.codeHash);await auth.bindPhone(user.id,phone,code,services.codeHash);expect((await auth.login(phone,'very-long-password')).user.id).toBe(user.id);await expect(auth.bindPhone(user.id,phone,code,services.codeHash)).rejects.toThrow('验证码');
  });
  it('lets an administrator re-enable a disabled account without restoring old sessions',async()=>{const workspace=randomUUID(),auth=createAuth(repo,workspace),admin=await auth.create('owner','very-long-password','admin'),user=await auth.register('member','very-long-password'),logged=await auth.login('member','very-long-password');await auth.disable(user.id,admin);await expect(auth.require(logged.token)).rejects.toThrow('登录');await expect(auth.login('member','very-long-password')).rejects.toThrow('账号');await auth.enable(user.id,admin);expect((await auth.login('member','very-long-password')).user.id).toBe(user.id);await expect(auth.require(logged.token)).rejects.toThrow('登录');});
  it('masks provider secrets, preserves them on unchanged IDs, and rejects concurrent stale edits',async()=>{
    const services=createAuthServices(path.join(root,'configuration')),initial=await services.configuration(),config={sms:{enabled:false,accessKeyId:'key-id',accessKeySecret:'secret',signName:'聆风',templateCode:'SMS_123456'},wechat:{enabled:false,appId:'wx1234567890abcdef',appSecret:'wechat-secret'}};
    const saved=await services.configure(config,initial.revision);expect(saved.sms.hasAccessKeySecret).toBe(true);expect(saved.sms.accessKeySecret).toBe('');expect(saved.wechat.appSecret).toBe('');
    await expect(services.configure(config,initial.revision)).rejects.toThrow('其他管理员');
    const updated=await services.configure({...config,sms:{...config.sms,accessKeySecret:''},wechat:{...config.wechat,appSecret:''}},saved.revision);expect(updated.sms.hasAccessKeySecret).toBe(true);expect(updated.wechat.hasAppSecret).toBe(true);
    expect(await services.codeHash('13800138000','123456')).not.toBe(await services.codeHash('13800138001','123456'));
  });
});
