import { beforeAll,afterAll,it,expect } from 'vitest';
import { createServer,type Server } from 'node:http';
import { mkdtemp,readFile,rm,mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { createRepository,type Repository } from '../packages/database/src';
import { defaultCosts } from '../packages/contracts/src';
import { createAutomation } from '../packages/automation/src/engine';
import { createMinimax } from '../packages/automation/src/minimax';
import { modelJson,parseModelJson } from '../packages/automation/src/providers';
import { requestBytes,providerAddressAllowed } from '../packages/automation/src/network';
import { defaults,type Job,type User,type SecretSettings } from '../packages/automation/src/types';
import { command,ownedFile } from '../packages/automation/src/media';
import { listingDocuments } from '../packages/automation/src/content-media';
import { safeSettings } from '../packages/automation/src/vault';
import fixture from './fixtures/content-kit.json';

let root:string,repo:Repository,server:Server,base:string,audio:Buffer,video:Buffer,submitted=0,pending=false,rejected=false;
const calls:{url:string;body:any;authorization?:string}[]=[];
const actor:User={id:randomUUID(),username:'qa',role:'admin',enabled:true};
const settings={...defaults,model:'MiniMax-M3',minimax:{...defaults.minimax,speechLimitCents:2,videoLimitCents:8},dailyLimitCents:100};
const secret:SecretSettings={...settings,apiKey:'',searchKey:'',minimaxKey:'FIXTURE-ONLY-KEY',verifiedAt:null,revision:'fixture'};
beforeAll(async()=>{
  root=await mkdtemp(path.join(os.tmpdir(),'agentsale-minimax-'));repo=await createRepository();
  await command('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=2','-y',path.join(root,'tone.mp3')]);audio=await readFile(path.join(root,'tone.mp3'));
  await command('ffmpeg',['-v','error','-f','lavfi','-i','color=c=white:s=720x1280:d=6:r=24','-c:v','libx264','-pix_fmt','yuv420p','-y',path.join(root,'source.mp4')]);video=await readFile(path.join(root,'source.mp4'));
  server=createServer((req,res)=>{let text='';req.on('data',b=>text+=b);req.on('end',()=>{const body=text?JSON.parse(text):null;calls.push({url:req.url!,body,authorization:req.headers.authorization});res.setHeader('Content-Type','application/json');const ok={base_resp:{status_code:0,status_msg:'success'}};
    if(rejected){res.end(JSON.stringify({base_resp:{status_code:1004,status_msg:'SECRET should not leak'}}));return;}
    if(req.url==='/v1/chat/completions'){res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"ready":true}',reasoning_details:[{text:'not content'}]}}],usage:{completion_tokens:8}}));return;}
    if(req.url==='/v1/t2a_v2'){res.end(JSON.stringify({...ok,data:{audio:audio.toString('hex'),status:2},extra_info:{usage_characters:15,audio_length:2000}}));return;}
    if(req.url==='/v1/video_generation'){submitted++;res.end(JSON.stringify({...ok,task_id:'123456789012345678'}));return;}
    if(req.url?.startsWith('/v1/query/video_generation')){res.end(JSON.stringify({...ok,task_id:'123456789012345678',status:pending?'Processing':'Success',file_id:'998877665544332211'}));return;}
    if(req.url?.startsWith('/v1/files/retrieve')){res.end(JSON.stringify({...ok,file:{file_id:'998877665544332211',download_url:'https://fixture-cdn.example/video.mp4'}}));return;}
    res.setHeader('Content-Type','video/mp4');res.end(video);
  });});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
afterAll(async()=>{await repo.close();await new Promise<void>(r=>server.close(()=>r()));if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('agentsale-minimax-'))await rm(root,{recursive:true,force:true});});
const provider=createMinimax((url,options)=>requestBytes(base+new URL(url).pathname+new URL(url).search,{...options,local:true}));
async function setup(budget=30){const w=randomUUID(),e=createAutomation(repo,w,path.join(root,w),{minimax:provider});await e.vault.save(settings,undefined,undefined,'FIXTURE-ONLY-KEY');const p=await repo.execute(w,{type:'product.create',name:'Synthetic fixture',sku:randomUUID(),supplier:'QA only',region:'China',market:'QA',description:'Synthetic fixture only',sourceUrl:'https://example.com',costs:defaultCosts},randomUUID());const png=await sharp({create:{width:500,height:700,channels:3,background:'#ccd4dc'}}).png().toBuffer();const asset=await e.upload(p.id,'fixture.png','Synthetic QA asset',png);const script={...fixture,listing:undefined};const j=await e.store.create({kind:'render',productId:p.id,expectedVersion:1,assetId:asset.id,script,voiceover:true,videoMode:'minimax',budgetCents:budget},actor,randomUUID());return {e,w,j,asset};}

it('MiniMax 文本协议分离推理，不发送未验证支持的 JSON 格式参数',async()=>{const config={...secret,baseUrl:base+'/v1',localModel:true,model:'MiniMax-M3',format:'prompt_json' as const,protocol:'minimax' as const};const result=await modelJson(config,z.object({ready:z.literal(true)}).strict(),'check','Return ready',true);expect(result.data.ready).toBe(true);const req=calls.at(-1)!;expect(req.body.reasoning_split).toBe(true);expect(req.body.thinking.type).toBe('disabled');expect(req.body.response_format).toBeUndefined();expect(req.body.messages[1].content).toContain('Required JSON schema');});

it('真实协议测试：配音解码、异步视频只提交一次、恢复轮询、无凭据下载与最终混音',async()=>{const {e,w,j}=await setup(),before=submitted;await e.tick();await e.tick();await e.tick();let current=await e.store.get(j.id);expect(current.remoteVideo?.taskId).toBe('123456789012345678');pending=true;await e.tick();current=await e.store.get(j.id);expect(current.state).toBe('queued');expect(await e.tick()).toBe(false);await e.store.control(j.id,'pause',current.version,actor);expect(await e.tick()).toBe(false);current=await e.store.get(j.id);await e.store.control(j.id,'resume',current.version,actor);pending=false;
  await repo.scoped(w,tx=>tx.execute(sql`UPDATE automation_jobs SET document=document-'nextRunAt' WHERE id=${j.id}`));
  for(let i=0;i<3;i++)await e.tick();current=await e.store.get(j.id);expect(current.state).toBe('waiting_review');expect(submitted-before).toBe(1);expect(current.artifacts.filter(a=>a.name.startsWith('poster-'))).toHaveLength(3);
  const final=current.artifacts.find(a=>a.name==='video.mp4')!;const probe=JSON.parse(await command('ffprobe',['-v','error','-show_streams','-of','json',ownedFile(e.root,final.file)]));expect(probe.streams.some((s:any)=>s.codec_type==='audio')).toBe(true);expect(calls.find(c=>c.url==='/video.mp4')?.authorization).toBeUndefined();expect(calls.find(c=>c.url==='/v1/video_generation')?.body.first_frame_image).toMatch(/^data:image\/png;base64,/);
  for(const [name,height] of [['square',1080],['portrait',1350],['story',1920]] as const){const meta=await sharp(ownedFile(e.root,current.artifacts.find(a=>a.name===`poster-${name}.png`)!.file)).metadata();expect(meta).toMatchObject({width:1080,height});}
},120000);

it('预算不足不留下已提交标记，也不发出视频请求',async()=>{const {e,j}=await setup(2),before=submitted;await e.tick();await e.tick();await e.tick();const result=await e.store.get(j.id);expect(result.error).toContain('BUDGET_EXCEEDED');expect(result.remoteVideo).toBeUndefined();expect(submitted).toBe(before);});

it('视频提交结果未知时禁止重发，填写原任务号后只恢复查询',async()=>{const {e,j}=await setup(),before=submitted;await e.tick();await e.tick();const claim=await e.store.claim();expect(claim?.step).toBe('video_submit');await e.store.checkpoint(j.id,claim!.lease,{remoteVideo:{taskId:'',endpoint:settings.minimax.baseUrl,status:'Submitting',submittedAt:new Date().toISOString()}});await e.store.recover();let current=await e.store.get(j.id);await e.store.control(j.id,'resume',current.version,actor);await e.tick();current=await e.store.get(j.id);expect(current.error).toContain('VIDEO_TASK_UNKNOWN');expect(submitted).toBe(before);await e.store.recoverVideo(j.id,current.version,'123456789012345678',actor);await e.tick();expect((await e.store.get(j.id)).remoteVideo?.status).toBe('Success');expect(submitted).toBe(before);});

it('MiniMax 业务错误码拒绝且不泄漏服务商原始错误内容',async()=>{rejected=true;try{await expect(provider.speech(root,{id:randomUUID(),copy:fixture} as Job,secret)).rejects.toMatchObject({code:'MINIMAX_REJECTED',message:'MiniMax 拒绝该请求，错误码 1004'});}finally{rejected=false;}});

it('电商 HTML 转义模型文本，完整导出详情和来源；多媒体密钥不返回运营',()=>{const job={copy:{...fixture,listing:{...fixture.listing,description:'<script>alert(1)</script>'}}} as Job;const files=listingDocuments(job);expect(files['product-description.html']).not.toContain('<script>');expect(files['product-description.html']).toContain('&lt;script&gt;');expect(JSON.parse(files['product-listing.json']).sourceIds).toEqual(['supplier-evidence']);expect(JSON.stringify(safeSettings(secret))).not.toContain(secret.minimaxKey);});

it('TUN 映射只对固定 MiniMax HTTPS 域名开放，供应商和真正内网仍被拒绝',()=>{expect(providerAddressAllowed(new URL('https://api.minimaxi.com/v1'),'198.18.0.154',true)).toBe(true);expect(providerAddressAllowed(new URL('https://api.minimaxi.com/v1'),'127.0.0.1',true)).toBe(false);expect(providerAddressAllowed(new URL('https://example.com'),'198.18.0.154',true)).toBe(false);expect(providerAddressAllowed(new URL('https://api.minimaxi.com/v1'),'198.18.0.154')).toBe(false);});

it('兼容模型的 Markdown 包裹和前言不影响严格 JSON 校验，多个对象与残缺输出拒绝',()=>{expect(parseModelJson('Here is the result:\n```json\n{"ready":true,"text":"a } brace"}\n```')).toMatchObject({ready:true});expect(parseModelJson('<think>internal</think>{"ready":true}')).toEqual({ready:true});expect(()=>parseModelJson('{"a":1}{"a":2}')).toThrow();expect(()=>parseModelJson('{"a":')).toThrow();});
