import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createRepository} from '../packages/database/src/index';
import {createAuth} from '../packages/automation/src/auth';
import {createMembership} from '../packages/automation/src/membership';
import {modelMigration} from '../packages/database/src/model-migration';

it('migrates stored plans, paid memberships and orders away from search billing',async()=>{
 const repo=await createRepository(),workspace=randomUUID();
 try{
  const auth=createAuth(repo,workspace),admin=await auth.create('administrator','test-long-password','admin'),user=await auth.register('member','test-long-password'),member=createMembership(repo,workspace);
  await member.savePlan({id:'standard',name:'会员',priceCents:100,days:30,published:true,limits:{model:2,image:1,video:0}},admin);
  const order=await member.createOrder(user,'standard','wechat');await member.settle(order.id,'wechat',100,'payment-one');
  const client=repo.db.$client;
  for(const [table,path] of [['membership_plans','{limits,search}'],['memberships','{plan,limits,search}'],['membership_orders','{plan,limits,search}']] as const){
   await client.query(`UPDATE ${table} SET document=jsonb_set(document,$1,'10'::jsonb) WHERE workspace_id=$2`,[path,workspace]);
  }
  await client.exec(modelMigration);
  expect((await member.plans(true))[0].limits).toEqual({model:2,image:1,video:0});
  expect((await member.status(user.id)).membership?.plan.limits).toEqual({model:2,image:1,video:0});
  expect((await member.order(order.id,user.id)).plan.limits).toEqual({model:2,image:1,video:0});
  expect((await member.status(user.id)).features).toEqual(['model','image']);
 }finally{await repo.close();}
});
