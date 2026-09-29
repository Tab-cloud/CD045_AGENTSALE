import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createModelMedia} from '../packages/automation/src/model-media';
import type {requestBytes} from '../packages/automation/src/network';

it('stores only provider configuration and performs image/video transport without Web business jobs',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'lingfeng-model-media-'));
  const image=await sharp({create:{width:8,height:8,channels:3,background:'#ddd'}}).png().toBuffer();
  const video=Buffer.concat([Buffer.from([0,0,0,16]),Buffer.from('ftyp'),Buffer.alloc(16)]);
  const calls:string[]=[];
  const transport:typeof requestBytes=async(url)=>{
    calls.push(url);
    let body:Buffer;
    if(url.endsWith('/images/generations'))body=Buffer.from(JSON.stringify({data:[{b64_json:image.toString('base64')}]}));
    else if(url.endsWith('/video_generation'))body=Buffer.from(JSON.stringify({base_resp:{status_code:0},task_id:'12345'}));
    else if(url.includes('/query/video_generation'))body=Buffer.from(JSON.stringify({base_resp:{status_code:0},task_id:'12345',status:'Success',file_id:'67890'}));
    else if(url.includes('/files/retrieve'))body=Buffer.from(JSON.stringify({base_resp:{status_code:0},file:{file_id:'67890',download_url:'https://api.minimaxi.com/video.mp4'}}));
    else body=video;
    return {status:200,headers:{},body,url};
  };
  try{
    const service=createModelMedia(root,transport),before=await service.configuration();
    const saved=await service.configure({image:{enabled:true,referenceEditing:false,baseUrl:'https://api.openai.com/v1',model:'image-fixture',size:'1024x1024'},video:{enabled:true,baseUrl:'https://api.minimaxi.com/v1',model:'MiniMax-Hailuo-02',duration:6,resolution:'768P'}},'image-secret','video-secret',before.revision);
    expect(saved).toMatchObject({hasImageKey:true,hasVideoKey:true});
    expect(JSON.stringify(saved)).not.toContain('secret');
    expect((await service.modelImage('画一张测试图')).bytes).toEqual(image);
    const submitted=await service.modelVideoSubmit('生成测试视频');
    expect(submitted.taskId).toBe('12345');
    const result=await service.modelVideoPoll(submitted.taskId,submitted.fingerprint);
    expect(result).toMatchObject({status:'completed',bytes:video});
    expect(calls.some(url=>url.endsWith('/images/generations'))).toBe(true);
    expect(calls.some(url=>url.endsWith('/video_generation'))).toBe(true);
    expect(await createModelMedia(root,transport).configuration()).toMatchObject({hasImageKey:true,hasVideoKey:true});
  }finally{await rm(root,{recursive:true,force:true});}
});

it('migrates sealed provider keys once without retaining a creative runtime route',async()=>{
  const {randomBytes,createCipheriv}=await import('node:crypto');
  const {mkdir,writeFile}=await import('node:fs/promises');
  const root=await mkdtemp(path.join(tmpdir(),'lingfeng-model-migration-'));
  try{
    const directory=path.join(root,'creative'),key=randomBytes(32),iv=randomBytes(12);
    await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'credentials.key'),key);
    const config={image:{enabled:true,referenceEditing:false,baseUrl:'https://api.openai.com/v1',model:'gpt-image-1',size:'1024x1024'},video:{enabled:false,baseUrl:'https://api.minimax.cn/v1',model:'MiniMax-Hailuo-2.3',duration:6,resolution:'768P'},editing:{enabled:true},avatar:{enabled:false}};
    const cipher=createCipheriv('aes-256-gcm',key,iv),encrypted=Buffer.concat([cipher.update(JSON.stringify({config,imageKey:'image-secret',videoKey:'video-secret'})),cipher.final()]);
    await writeFile(path.join(directory,'credentials.sealed'),Buffer.concat([iv,cipher.getAuthTag(),encrypted]));
    const first=await createModelMedia(root).configuration();
    expect(first).toMatchObject({hasImageKey:true,hasVideoKey:true,image:config.image,video:config.video});
    expect(first).not.toHaveProperty('editing');expect(first).not.toHaveProperty('avatar');
    await rm(directory,{recursive:true});
    const second=await createModelMedia(root).configuration();
    expect(second).toMatchObject({hasImageKey:true,hasVideoKey:true,image:config.image});
  }finally{await rm(root,{recursive:true,force:true});}
});
