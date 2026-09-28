import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createRepository,type Repository} from '../packages/database/src/index';
import {createAuth} from '../packages/automation/src/auth';
import {createMembership,type Plan} from '../packages/automation/src/membership';
import {sql} from 'drizzle-orm';
import {randomUUID} from 'node:crypto';
let repo:Repository;beforeAll(async()=>{repo=await createRepository();},30000);afterAll(async()=>repo?.close());
async function setup(){const workspace=randomUUID(),auth=createAuth(repo,workspace),members=createMembership(repo,workspace),admin=await auth.create('administrator','test-long-password','admin'),user=await auth.register('member','test-long-password');const plan:Plan={id:'test',name:'测试套餐',days:30,priceCents:100,published:true,limits:{model:2,search:1,image:1,video:0}};await members.savePlan(plan,admin);return {workspace,auth,members,admin,user,plan};}
describe('subscription authority',()=>{
 it('paginates and searches members without loading the entire user list',async()=>{
  const {auth,members,admin,user,plan}=await setup();
  await expect(members.usersPage(user,1,'')).rejects.toThrow('管理员');
  await Promise.all(Array.from({length:22},(_,index)=>auth.register(`user-${String(index).padStart(2,'0')}`,'test-long-password')));
  const first=await members.usersPage(admin,1,'');
  expect(first.total).toBe(24);
  expect(first.users).toHaveLength(20);
  expect((await members.usersPage(admin,2,'')).users).toHaveLength(4);
  const match=await members.usersPage(admin,1,'MEMber');
  expect(match.users.map(account=>account.username)).toEqual(['member']);
  const order=await members.createOrder(user,plan.id,'wechat');
  await members.settle(order.id,'wechat',100,'member-page-payment');
  expect((await members.usersPage(admin,1,'member')).users[0].subscription.active).toBe(true);
 });
 it('reports real administrator dashboard totals, trend and usage',async()=>{
  const {members,user,admin}=await setup();
  await expect(members.dashboard(user)).rejects.toThrow('管理员');
  const empty=await members.dashboard(admin);
  expect(empty.totals).toEqual({users:1,activeMembers:0,paidOrders:0,pendingOrders:0,revenueCents:0});
  expect(empty.trend).toHaveLength(7);
  expect(empty.recentOrders).toEqual([]);
  const order=await members.createOrder(user,'test','wechat');
  expect((await members.dashboard(admin)).totals.pendingOrders).toBe(1);
  await members.settle(order.id,'wechat',100,'dashboard-payment');
  await members.consume(user.id,'search');
  const result=await members.dashboard(admin);
  expect(result.totals).toEqual({users:1,activeMembers:1,paidOrders:1,pendingOrders:0,revenueCents:100});
  expect(result.trend.at(-1)).toMatchObject({paidOrders:1,revenueCents:100,usage:1});
  expect(result.usageToday.find(item=>item.feature==='search')?.count).toBe(1);
  expect(result.recentOrders[0]).toMatchObject({id:order.id,username:user.username,priceCents:100,channel:'wechat'});
  await members.revoke(user.id,admin);
  expect((await members.dashboard(admin)).totals).toMatchObject({activeMembers:0,paidOrders:1,revenueCents:100});
 });
 it('registration never creates administrators; configuration requires admin; sessions can be revoked',async()=>{const {auth,members,user,plan}=await setup();expect(user.role).toBe('operator');await expect(auth.create('badadmin','test-long-password','admin',user)).rejects.toThrow('管理员');await expect(members.savePlan(plan,user)).rejects.toThrow('管理员');const logged=await auth.login('member','test-long-password');await expect(auth.require(logged.token,true)).rejects.toThrow('管理员');await auth.logout(logged.token);await expect(auth.require(logged.token)).rejects.toThrow('登录');});
 it('blocks unsubscribed, expired and revoked users, including administrators without a plan',async()=>{const {workspace,members,user,admin}=await setup();await expect(members.consume(admin.id,'model')).rejects.toThrow('会员');await expect(members.consume(user.id,'search')).rejects.toThrow('会员');const order=await members.createOrder(user,'test','wechat');await members.settle(order.id,'wechat',100,'transaction-one');await members.requireFeature(user.id,'model');await expect(members.requireFeature(user.id,'video')).rejects.toThrow('会员');await repo.scoped(workspace,async tx=>{await tx.execute(sql`UPDATE memberships SET document=jsonb_set(document,'{expiresAt}','"2000-01-01T00:00:00.000Z"'::jsonb) WHERE user_id=${user.id}`);});await expect(members.consume(user.id,'model')).rejects.toThrow('到期');await members.revoke(user.id,admin);expect((await members.status(user.id)).active).toBe(false);});
 it('validates provider, amount and transaction; repeated settlement extends membership exactly once',async()=>{const {members,user,plan,admin}=await setup();const o=await members.createOrder(user,'test','alipay');await members.savePlan({...plan,priceCents:999},admin);await expect(members.settle(o.id,'wechat',100,'tx')).rejects.toThrow('校验');await expect(members.settle(o.id,'alipay',99,'tx')).rejects.toThrow('校验');await members.settle(o.id,'alipay',100,'tx');const expires=(await members.status(user.id)).membership!.expiresAt;await Promise.all([members.settle(o.id,'alipay',100,'tx'),members.settle(o.id,'alipay',100,'tx')]);expect((await members.status(user.id)).membership!.expiresAt).toBe(expires);await expect(members.settle(o.id,'alipay',100,'different')).rejects.toThrow('流水');});
 it('enforces concurrent daily limits and charges one media reservation per id',async()=>{const {members,user,auth}=await setup();const o=await members.createOrder(user,'test','wechat');await members.settle(o.id,'wechat',100,'tx');const results=await Promise.allSettled(Array.from({length:4},()=>members.consume(user.id,'model')));expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(2);const id=randomUUID();await Promise.all([members.claimAsset(id,user.id,'image'),members.claimAsset(id,user.id,'image')]);await expect(members.claimAsset(randomUUID(),user.id,'image')).rejects.toThrow('额度');const other=await auth.register('another','test-long-password');await expect(members.ownAsset(id,other.id)).rejects.toThrow('不存在');await expect(members.order(o.id,other.id)).rejects.toThrow('不存在');});
});
