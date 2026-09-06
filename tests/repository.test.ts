import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { sql } from 'drizzle-orm';
import { createRepository, type Repository } from '../packages/database/src/index';
import * as schema from '../packages/database/src/schema';
import { defaultCosts, type Command } from '../packages/contracts/src/index';

let repo:Repository;
const create=(sku='TEST-001'):Command=>({type:'product.create',name:'测试商品',sku,supplier:'测试工厂',region:'中国大陆',market:'待确定',description:'仅测试',sourceUrl:'https://example.com/source',costs:defaultCosts});
const key=()=>randomUUID();
beforeAll(async()=>{repo=await createRepository();});
afterAll(async()=>{await repo.close();});

describe('数据库、工作区隔离和任务一致性',()=>{
  it('重复初始化不会重复示例商品',async()=>{
    const w=key();await repo.seed(w);await repo.seed(w);expect((await repo.snapshot(w)).products).toHaveLength(3);
  });
  it('录入来源与商品作为一个事务保存',async()=>{
    const w=key();const result=await repo.execute(w,create(),key());const s=await repo.snapshot(w);
    expect(s.products[0].id).toBe(result.id);expect(s.evidence[0].productId).toBe(result.id);expect(s.audit).toHaveLength(1);
  });
  it('同时重放相同幂等键只创建一次',async()=>{
    const w=key(), k=key();const results=await Promise.all([repo.execute(w,create(),k),repo.execute(w,create(),k)]);
    expect(results[0].id).toBe(results[1].id);expect((await repo.snapshot(w)).products).toHaveLength(1);
  });
  it('相同标识的不同参数被拒绝，重复 SKU 不覆盖记录',async()=>{
    const w=key(),k=key();await repo.execute(w,create(),k);
    await expect(repo.execute(w,create('TEST-002'),k)).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    await expect(repo.execute(w,create(),key())).rejects.toMatchObject({code:'DUPLICATE_SKU'});
  });
  it('RLS 运行角色不是表所有者，跨工作区读写被阻止',async()=>{
    const a=key(),b=key();await repo.execute(a,create(),key());await repo.execute(b,create(),key());
    const rows=await repo.scoped(a,tx=>tx.select().from(schema.products));expect(rows).toHaveLength(1);expect(rows[0].workspaceId).toBe(a);
    const role=await repo.scoped(a,tx=>tx.execute(sql`SELECT current_user AS role`));expect(role.rows[0]).toMatchObject({role:'agentsale_local'});
    const target=(await repo.snapshot(b)).products[0];
    await expect(repo.execute(a,{type:'product.costs',id:target.id,expectedVersion:1,costs:defaultCosts},key())).rejects.toMatchObject({code:'NOT_FOUND'});
    await expect(repo.scoped(a,tx=>tx.insert(schema.products).values({...target,id:key(),sku:'OTHER',workspaceId:b}))).rejects.toThrow();
  });
  it('成本更新检查版本，失败不增加审计或修改金额',async()=>{
    const w=key();const {id}=await repo.execute(w,create(),key());await repo.execute(w,{type:'product.costs',id,expectedVersion:1,costs:{...defaultCosts,revenueMinor:3990}},key());
    await expect(repo.execute(w,{type:'product.costs',id,expectedVersion:1,costs:defaultCosts},key())).rejects.toMatchObject({code:'VERSION_CONFLICT'});
    const s=await repo.snapshot(w);expect(s.products[0].costs.revenueMinor).toBe(3990);expect(s.audit).toHaveLength(2);
  });
  it('拒绝不安全来源协议与非法金额',async()=>{
    const w=key();await expect(repo.execute(w,{...create(),sourceUrl:'javascript:alert(1)'},key())).rejects.toMatchObject({code:'INPUT_INVALID'});
    await expect(repo.execute(w,{...create(),costs:{...defaultCosts,revenueMinor:-1}},key())).rejects.toMatchObject({code:'INPUT_INVALID'});
    expect((await repo.snapshot(w)).products).toHaveLength(0);
  });
  it('缺失运费的评估保留缺失结果，不声称最终利润',async()=>{
    const w=key();const {id}=await repo.execute(w,{...create(),costs:{...defaultCosts,shippingMinor:null}},key());await repo.execute(w,{type:'run.create',productId:id,expectedVersion:1,kind:'assessment'},key());
    await repo.processOne(w);const s=await repo.snapshot(w);expect(s.runs[0].summary).toContain('未生成最终利润');expect(s.runs[0].state).toBe('succeeded');
  });
  it('任务暂停后不消费，继续后只生成一份草稿',async()=>{
    const w=key();const {id}=await repo.execute(w,create(),key());const run=await repo.execute(w,{type:'run.create',productId:id,expectedVersion:1,kind:'content'},key());
    await repo.execute(w,{type:'run.pause',id:run.id,expectedVersion:1},key());expect(await repo.processOne(w)).toBe(false);
    await repo.execute(w,{type:'run.resume',id:run.id,expectedVersion:2},key());expect(await repo.processOne(w)).toBe(true);expect(await repo.processOne(w)).toBe(false);
    expect((await repo.snapshot(w)).drafts).toHaveLength(1);
  });
  it('资料变更后，旧任务失败且旧草稿不能直接审阅',async()=>{
    const w=key();const {id}=await repo.execute(w,create(),key());await repo.execute(w,{type:'run.create',productId:id,expectedVersion:1,kind:'content'},key());await repo.processOne(w);
    const draft=(await repo.snapshot(w)).drafts[0];await repo.execute(w,{type:'run.create',productId:id,expectedVersion:1,kind:'assessment'},key());
    await repo.execute(w,{type:'product.costs',id,expectedVersion:1,costs:{...defaultCosts,revenueMinor:3990}},key());await repo.processOne(w);
    await expect(repo.execute(w,{type:'draft.review',id:draft.id,expectedVersion:1,decision:'approve'},key())).rejects.toMatchObject({code:'VERSION_CONFLICT'});
    const s=await repo.snapshot(w);expect(s.runs.some(r=>r.state==='failed')).toBe(true);expect(s.drafts[0].state).toBe('review_required');
  });
  it('修改脚本会撤销原审阅，保留新的版本',async()=>{
    const w=key();const {id}=await repo.execute(w,create(),key());await repo.execute(w,{type:'run.create',productId:id,expectedVersion:1,kind:'content'},key());await repo.processOne(w);const draft=(await repo.snapshot(w)).drafts[0];
    await repo.execute(w,{type:'draft.review',id:draft.id,expectedVersion:1,decision:'approve'},key());
    await repo.execute(w,{type:'draft.edit',id:draft.id,expectedVersion:2,expectedProductVersion:1,script:'人工修订的脚本'},key());const s=await repo.snapshot(w);expect(s.drafts[0]).toMatchObject({version:3,state:'review_required',script:'人工修订的脚本'});
  });
  it('资料确认仅记录人工判断，并使商品版本递增',async()=>{
    const w=key();const {id}=await repo.execute(w,create(),key());await repo.execute(w,{type:'evidence.add',productId:id,expectedVersion:1,title:'包装资料',url:'https://example.com/specs',note:'仅测试确认',confirmed:true},key());
    const s=await repo.snapshot(w);expect(s.products[0].version).toBe(2);expect(s.evidence.filter(e=>e.confirmed)).toHaveLength(1);
  });
});

it('关闭并重新打开数据库后保留排队任务，并可继续完成',async()=>{
  const parent=path.resolve(os.tmpdir(),'agentsale-test-storage');await mkdir(parent,{recursive:true});const dir=path.join(parent,key());
  let persistent:Repository|undefined;
  try {
    persistent=await createRepository(dir);const {id}=await persistent.execute('persist',create(),key());await persistent.execute('persist',{type:'run.create',productId:id,expectedVersion:1,kind:'assessment'},key());await persistent.close();persistent=undefined;
    persistent=await createRepository(dir);expect((await persistent.snapshot('persist')).runs[0].state).toBe('queued');await persistent.processOne('persist');expect((await persistent.snapshot('persist')).runs[0].state).toBe('succeeded');
  } finally {await persistent?.close();if(path.dirname(path.resolve(dir))===parent)await rm(dir,{recursive:true,force:true});}
});
