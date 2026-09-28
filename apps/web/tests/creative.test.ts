import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, mkdir, writeFile, chmod, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createCreativeService, creativeDefaults } from '../packages/automation/src/creative';
import type { requestBytes } from '../packages/automation/src/network';
const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
async function setup(transport:typeof requestBytes){const root=await mkdtemp(path.join(tmpdir(),'lingfeng-creative-'));dirs.push(root);return {root,service:createCreativeService(root,transport)};}
const response=(body:unknown)=>({status:200,headers:{},body:Buffer.from(JSON.stringify(body)),url:'https://example.com'});
const enabled=()=>({image:{...creativeDefaults.image,enabled:true},video:{...creativeDefaults.video,enabled:true}});
describe('creative provider gateway',()=>{
  it('renders an owner-scoped local avatar job once and serves the saved MP4',async()=>{
    const {root,service}=await setup(async()=>{throw new Error('avatar must not call a paid API');});
    const repo=path.join(root,'SadTalker');await mkdir(path.join(repo,'checkpoints'),{recursive:true});await writeFile(path.join(repo,'inference.py'),'# test fixture');
    const python=path.join(root,'fake-python');
    await writeFile(python,`#!/bin/sh
python3 - "$2" <<'PYWORKER'
import json,sys,pathlib
job=json.loads(pathlib.Path(sys.argv[1]).read_text())
folder=pathlib.Path(job['output'])
(folder/'video.mp4').write_bytes(bytes([0,0,0,20])+b'ftypisom'+bytes([0,0,0,0]))
(folder/'worker-result.json').write_text(json.dumps({'status':'completed'}))
PYWORKER
`);await chmod(python,0o755);
    await service.configure({...creativeDefaults,avatar:{enabled:true,meloPythonPath:python,sadTalkerPythonPath:python,sadTalkerPath:repo}});
    const image=await sharp({create:{width:64,height:64,channels:3,background:'#ddd'}}).png().toBuffer();
    const portrait=await service.importPortrait(image.toString('base64'));
    const request={id:randomUUID(),kind:'avatar',prompt:'欢迎了解我们的新品',portraitId:portrait.id};
    const first=await service.start(request);expect(first.status).toBe('processing');
    expect((await service.start(request)).id).toBe(first.id);
    let completed=first;for(let i=0;i<100&&completed.status==='processing';i++){await new Promise(resolve=>setTimeout(resolve,20));completed=await service.poll(first.id);}
    expect(completed.status,JSON.stringify(await readdir(path.join(root,'creative',first.id)))).toBe('completed');expect((await service.asset(first.id)).mime).toBe('video/mp4');
    expect((await createCreativeService(root).start(request)).status).toBe('completed');
    await expect(service.start({...request,portraitId:randomUUID()})).rejects.toThrow('同一任务号');
  });
  it('requires local installation and keeps portraits private to their member',async()=>{
    const {root,service}=await setup(async()=>{throw new Error('must not call a provider');});
    expect(()=>service.start({id:randomUUID(),kind:'avatar',prompt:'口播'})).toThrow();
    await expect(service.start({id:randomUUID(),kind:'avatar',prompt:'口播',portraitId:randomUUID()})).rejects.toThrow('启用');
    await expect(service.configure({...creativeDefaults,avatar:{enabled:true,meloPythonPath:'/missing/python',sadTalkerPythonPath:'/missing/python',sadTalkerPath:'/missing/repo'}})).rejects.toThrow('未找到');
    const image=await sharp({create:{width:8,height:8,channels:3,background:'#ddd'}}).png().toBuffer();
    const a=createCreativeService(root,undefined,randomUUID()),b=createCreativeService(root,undefined,randomUUID());
    const portrait=await a.importPortrait(image.toString('base64'));
    await expect(b.validatePortrait(portrait.id)).rejects.toThrow('不属于');
  });
  it('seals credentials and never exposes them in configuration or capabilities',async()=>{
    const {root,service}=await setup(async()=>{throw new Error('must not call provider');});
    const value=await service.configure(enabled(),'secret-image','secret-video');
    expect(value.hasImageKey).toBe(true);expect(JSON.stringify(value)).not.toContain('secret-image');
    expect((await readFile(path.join(root,'creative/credentials.sealed'))).includes(Buffer.from('secret-image'))).toBe(false);
    expect(await createCreativeService(root).capabilities()).toMatchObject({image:true,video:true});
    expect(await service.configuration()).not.toHaveProperty('imageKey');
  });
  it('persists a real PNG and submits an idempotent request only once across concurrent requests and restarts',async()=>{
    const png=await sharp({create:{width:16,height:16,channels:3,background:'#123456'}}).png().toBuffer();let calls=0;
    const transport:typeof requestBytes=async(url,options)=>{calls++;expect(url).toContain('/images/generations');expect(JSON.parse(String(options?.body))).toMatchObject({n:1,prompt:'A quiet forest'});return response({data:[{b64_json:png.toString('base64')}]});};
    const {root,service}=await setup(transport);await service.configure(enabled(),'image-test','video-test');
    const request={id:randomUUID(),kind:'image',prompt:'A quiet forest'};
    const jobs=await Promise.all([service.start(request),service.start(request)]);
    expect(jobs.every(job=>job.status==='completed')).toBe(true);expect(calls).toBe(1);
    expect((await service.asset(request.id)).bytes.subarray(1,4).toString()).toBe('PNG');
    expect((await createCreativeService(root,transport).start(request)).status).toBe('completed');expect(calls).toBe(1);
    await expect(service.start({...request,prompt:'different'})).rejects.toThrow('同一任务号');
  });
  it('does not retry an image submission when the provider result is unknown',async()=>{
    let calls=0;const {root,service}=await setup(async()=>{calls++;throw new Error('timeout, raw secret diagnostics');});await service.configure(enabled(),'one','two');
    const request={id:randomUUID(),kind:'image',prompt:'A test image'};
    const job=await service.start(request);expect(job.status).toBe('unknown');expect(job.message).not.toContain('secret');
    await createCreativeService(root,async()=>{calls++;throw new Error('must not retry');}).start(request);expect(calls).toBe(1);
  });
  it('polls one existing video task, validates IDs and downloads without sending provider credentials',async()=>{
    let submissions=0;const calls:string[]=[];
    const transport:typeof requestBytes=async(url,options)=>{calls.push(url);
      if(url.endsWith('/video_generation')&&options?.method==='POST'){submissions++;return response({base_resp:{status_code:0},task_id:'123'});}
      if(url.includes('/query/'))return response({base_resp:{status_code:0},task_id:'123',status:'Success',file_id:'456'});
      if(url.includes('/files/'))return response({base_resp:{status_code:0},file:{file_id:'456',download_url:'https://example.com/test.mp4'}});
      expect(options?.headers?.Authorization).toBeUndefined();return {...response({}),body:Buffer.from([0,0,0,20,...Buffer.from('ftypisom'),0,0,0,0])};
    };
    const {service}=await setup(transport);await service.configure(enabled(),'one','two');
    const job=await service.start({id:randomUUID(),kind:'video',prompt:'Slow camera pan across a forest'});
    expect(job.taskId).toBe('123');expect(job.status).toBe('processing');
    expect((await service.poll(job.id)).status).toBe('completed');await service.poll(job.id);expect(submissions).toBe(1);expect(calls).toHaveLength(4);
  });
  it('blocks disabled services and changed credentials before provider calls',async()=>{
    let calls=0;const {service}=await setup(async()=>{calls++;return response({base_resp:{status_code:0},task_id:'123'});});
    await expect(service.start({id:randomUUID(),kind:'image',prompt:'test'})).rejects.toThrow('启用');expect(calls).toBe(0);
    await service.configure(enabled(),'one','two');const job=await service.start({id:randomUUID(),kind:'video',prompt:'test'});
    await service.configure(enabled(),undefined,'changed');await expect(service.poll(job.id)).rejects.toThrow('变更');expect(calls).toBe(1);
  });
  it('does not retain a credential when its provider endpoint changes',async()=>{
    const {service}=await setup(async()=>{throw new Error('must not call');});await service.configure(enabled(),'one','two');
    const config=enabled();config.image.baseUrl='https://new.example.com/v1';config.image.enabled=false;
    expect((await service.configure(config)).hasImageKey).toBe(false);
    await expect(service.configure({...config,image:{...config.image,baseUrl:'http://127.0.0.1:3000'}})).rejects.toThrow();
  });
});

describe('creative configuration portal boundary',()=>{
  it('rejects cross-origin configuration writes before proxying',async()=>{
    const {forwardAdminRequest}=await import('../scripts/admin-static-server.mjs');
    const response=await forwardAdminRequest(new Request('http://127.0.0.1:3047/api/v1/creative-config',{method:'POST',headers:{host:'127.0.0.1:3047',origin:'https://untrusted.example'},body:'{}'}),{});
    expect(response.status).toBe(403);
  });
});

describe('ecommerce reference image generation',()=>{
  it('normalizes and deduplicates product photos, sends multipart edits and preserves idempotency',async()=>{
    const photo=await sharp({create:{width:32,height:16,channels:3,background:'#e8e3db'}}).jpeg().toBuffer();
    const png=await sharp(photo).png().toBuffer();let calls=0;
    const {service}=await setup(async(url,options)=>{
      calls++;expect(url.endsWith('/images/edits')).toBe(true);
      expect(options?.headers?.Authorization).toBe('Bearer test-image');
      const form=await new Response(new Uint8Array(options?.body as Buffer),{headers:{'Content-Type':options!.headers!['Content-Type']}}).formData();
      expect(form.get('prompt')).toBe('Product main photo');expect(form.get('n')).toBe('1');
      const file=form.get('image') as File;expect(file.type).toBe('image/png');expect((await sharp(Buffer.from(await file.arrayBuffer())).metadata()).width).toBe(32);
      return response({data:[{b64_json:png.toString('base64')}]});
    });
    await service.configure({...enabled(),image:{...enabled().image,referenceEditing:true}},'test-image','video');
    const first=await service.importReference(photo.toString('base64')),second=await service.importReference(photo.toString('base64'));
    expect(first.id).toBe(second.id);
    const request={id:randomUUID(),kind:'image',prompt:'Product main photo',referenceId:first.id};
    expect((await service.start(request)).status).toBe('completed');await service.start(request);expect(calls).toBe(1);
    await expect(service.start({...request,referenceId:randomUUID()})).rejects.toThrow('同一任务号');
  });
  it('keeps references private to the member and blocks unsupported editing before a paid call',async()=>{
    let calls=0;const transport:typeof requestBytes=async()=>{calls++;throw new Error('must not call');};
    const {root,service}=await setup(transport);await service.configure(enabled(),'one','two');
    const a=createCreativeService(root,transport,randomUUID()),b=createCreativeService(root,transport,randomUUID());
    const photo=await sharp({create:{width:10,height:10,channels:3,background:'#fff'}}).png().toBuffer();
    const ref=await a.importReference(photo.toString('base64'));
    await expect(a.start({id:randomUUID(),kind:'image',prompt:'test',referenceId:ref.id})).rejects.toThrow('启用');
    await service.configure({...enabled(),image:{...enabled().image,referenceEditing:true}});
    await expect(b.start({id:randomUUID(),kind:'image',prompt:'test',referenceId:ref.id})).rejects.toThrow('不属于');
    expect(()=>a.start({id:randomUUID(),kind:'video',prompt:'test',referenceId:ref.id})).toThrow();
    expect(calls).toBe(0);
    await expect(a.importReference(Buffer.from('<svg></svg>').toString('base64'))).rejects.toThrow('无法解析');
    await expect(a.importReference('a'.repeat(5_333_337))).rejects.toThrow('4 MB');
  });
});
