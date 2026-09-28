import {it,expect,afterAll,beforeAll} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createCreativeService,creativeDefaults} from '../packages/automation/src/creative';
import {createVideoEditor,editingAvailable} from '../packages/automation/src/video-edit';
const exec=promisify(execFile),available=await editingAvailable();
let root:string,data:string;
beforeAll(async()=>{root=await mkdtemp(path.join(tmpdir(),'lingfeng-edit-'));if(!available)return;const file=path.join(root,'fixture.mp4');await exec('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=3','-f','lavfi','-i','sine=frequency=440:duration=3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',file]);data=(await readFile(file)).toString('base64');},30000);
afterAll(async()=>{await rm(root,{recursive:true,force:true});});
it.skipIf(!available)('renders a real MP4 with exact duration, requested aspect and muted audio without a provider',async()=>{
 const owner=randomUUID(),service=createCreativeService(root,async()=>{throw new Error('must not call remote provider')},owner);
 await service.configure({...creativeDefaults,editing:{enabled:true}});
 const source=await service.importVideo(data,'测试素材.mp4');expect(source).toMatchObject({width:320,height:180,audio:true});
 const request={id:randomUUID(),kind:'video',prompt:'截取1到2秒，改方形，静音',editPlan:{sourceId:source.id,start:1,end:2,aspect:'square',mute:true}};
 const first=await service.start(request);expect(first.status).toBe('completed');expect((await service.start(request)).updatedAt).toBe(first.updatedAt);
 const asset=await service.asset(request.id);expect(asset.mime).toBe('video/mp4');const output=path.join(root,'result.mp4');await writeFile(output,asset.bytes);
 const {stdout}=await exec('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output]);const result=JSON.parse(stdout);expect(result.streams[0]).toMatchObject({width:720,height:720});expect(result.streams.some((s:any)=>s.codec_type==='audio')).toBe(false);expect(Number(result.format.duration)).toBeCloseTo(1,1);
 await expect(service.start({...request,editPlan:{...request.editPlan,mute:false}})).rejects.toThrow('同一任务号');
},30000);
it.skipIf(!available)('rejects cross-account sources, invalid intervals and shell-like values before rendering',async()=>{
 const a=createVideoEditor(path.join(root,'a')),b=createVideoEditor(path.join(root,'b')),source=await a.importVideo(data,'fixture.mp4');
 const plan={sourceId:source.id,start:0,end:2,aspect:'original',mute:false};
 await expect(b.validate(plan)).rejects.toThrow('不属于');await expect(a.validate({...plan,end:10})).rejects.toThrow('范围');await expect(a.validate({...plan,start:2,end:1})).rejects.toThrow('范围');await expect(a.validate({...plan,aspect:'square; touch /tmp/bad'})).rejects.toThrow();await expect(a.validate({...plan,sourceId:'../../private'})).rejects.toThrow();
});
it.skipIf(!available)('requires administrator enablement and rejects malformed media',async()=>{
 const service=createCreativeService(path.join(root,'disabled'));await expect(service.importVideo(data,'clip.mp4')).rejects.toThrow('启用');
 const editor=createVideoEditor(path.join(root,'bad'));await expect(editor.importVideo(Buffer.from('not a video').toString('base64'),'bad.mp4')).rejects.toThrow();
 const malicious=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftyp'),Buffer.from('invalid fixture')]);await expect(editor.importVideo(malicious.toString('base64'),'bad.mov')).rejects.toThrow('无法读取');
});
