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

describe('public OAuth return',()=>{
  const old=process.env.LINGFENG_ADMIN_URL;
  afterAll(()=>{if(old===undefined)delete process.env.LINGFENG_ADMIN_URL;else process.env.LINGFENG_ADMIN_URL=old;});
  it('returns denied authorization to the configured admin origin',async()=>{
    process.env.LINGFENG_ADMIN_URL='https://admin.example.com';
    const {GET}=await import('../console/app/api/v1/oauth/[connector]/callback/route');
    const result=await GET(new Request('https://members.example.com/api/v1/oauth/temu/callback?error=denied'),{params:Promise.resolve({connector:'temu'})});
    expect(result.status).toBe(302);expect(result.headers.get('location')).toBe('https://admin.example.com/?oauth=denied&connector=temu');
  });
});

describe('connector webhook body limit',()=>{
  it('rejects oversized events before opening the automation store',async()=>{
    const {POST}=await import('../console/app/api/v1/webhooks/[connector]/route');
    const result=await POST(new Request('http://127.0.0.1:3045/api/v1/webhooks/temu',{method:'POST',body:'x'.repeat(1_000_001)}),{params:Promise.resolve({connector:'temu'})});
    expect(result.status).toBe(413);
  });
});

describe('public data initialization',()=>{
  let root:string;const oldData=process.env.AGENTSALE_DATA_DIR,oldPublic=process.env.LINGFENG_PUBLIC_URL,oldDemo=process.env.AGENTSALE_LOCAL_DEMO;
  beforeAll(async()=>{root=await mkdtemp(path.join(tmpdir(),'lingfeng-public-init-'));process.env.AGENTSALE_DATA_DIR=path.join(root,'pglite');process.env.LINGFENG_PUBLIC_URL='https://members.example.com';process.env.AGENTSALE_LOCAL_DEMO='0';});
  afterAll(async()=>{const {getRepository}=await import('../console/lib/local-runtime');await (await getRepository()).close();await rm(root,{recursive:true,force:true});for(const [key,value] of [['AGENTSALE_DATA_DIR',oldData],['LINGFENG_PUBLIC_URL',oldPublic],['AGENTSALE_LOCAL_DEMO',oldDemo]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  it('creates empty production tables without inserting demo products',async()=>{
    const {getRepository}=await import('../console/lib/local-runtime');
    const {LOCAL_WORKSPACE}=await import('@agentsale/database');
    expect((await (await getRepository()).snapshot(LOCAL_WORKSPACE)).products).toHaveLength(0);
  });
});
