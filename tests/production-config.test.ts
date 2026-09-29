import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {productionConfig} from '../scripts/production-config.mjs';

describe('production startup boundaries',()=>{
  const root='/opt/lingfeng';
  const valid={LINGFENG_PUBLIC_URL:'https://members.example.com',LINGFENG_ADMIN_URL:'https://admin.example.com',AGENTSALE_DATA_DIR:'/var/lib/lingfeng/pglite'};
  it('requires two HTTPS origins and a persistent path outside the checkout',()=>{
    expect(productionConfig(valid,root)).toMatchObject({publicOrigin:valid.LINGFENG_PUBLIC_URL,adminOrigin:valid.LINGFENG_ADMIN_URL,dataDir:valid.AGENTSALE_DATA_DIR});
    expect(()=>productionConfig({...valid,LINGFENG_ADMIN_URL:'http://admin.example.com'},root)).toThrow('HTTPS');
    expect(()=>productionConfig({...valid,LINGFENG_ADMIN_URL:valid.LINGFENG_PUBLIC_URL},root)).toThrow('differ');
    expect(()=>productionConfig({...valid,AGENTSALE_DATA_DIR:'/opt/lingfeng/.local/pglite'},root)).toThrow('outside');
    expect(()=>productionConfig({...valid,AGENTSALE_DATA_DIR:'./data'},root)).toThrow('absolute');
    expect(()=>productionConfig({...valid,LINGFENG_LEGACY_ADMIN_WORKER:'1'},root)).toThrow('Legacy');
  });
  it('keeps local development available without public configuration',()=>expect(productionConfig({},root)).toBeNull());
});

describe('public data initialization',()=>{
  let root:string;const oldData=process.env.AGENTSALE_DATA_DIR,oldPublic=process.env.LINGFENG_PUBLIC_URL,oldDemo=process.env.AGENTSALE_LOCAL_DEMO;
  beforeAll(async()=>{root=await mkdtemp(path.join(tmpdir(),'lingfeng-public-init-'));process.env.AGENTSALE_DATA_DIR=path.join(root,'pglite');process.env.LINGFENG_PUBLIC_URL='https://members.example.com';process.env.AGENTSALE_LOCAL_DEMO='0';});
  afterAll(async()=>{const {getRepository}=await import('../console/lib/local-runtime');await (await getRepository()).close();await rm(root,{recursive:true,force:true});for(const [key,value] of [['AGENTSALE_DATA_DIR',oldData],['LINGFENG_PUBLIC_URL',oldPublic],['AGENTSALE_LOCAL_DEMO',oldDemo]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  it('creates only account, billing and model tables for a new deployment',async()=>{
    const {getRepository}=await import('../console/lib/local-runtime');
    const rows=(await (await getRepository()).db.$client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows;
    const names=rows.map(row=>String(row.tablename));
    for(const table of ['app_users','membership_plans','model_requests','audit'])expect(names).toContain(table);
    for(const table of ['products','automation_jobs','knowledge_libraries','commerce_orders'])expect(names).not.toContain(table);
  });
});
