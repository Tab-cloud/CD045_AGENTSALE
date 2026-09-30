import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createModelMedia} from '../packages/automation/src/model-media';
import type {requestBytes} from '../packages/automation/src/network';

it('stores only provider configuration and performs image/video transport without Web business jobs',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'lingfeng-model-media-'));
  const image=Buffer.from([0xff,0xd8,0xff,0xe0,1,2,3,4]);
  const imageReply=Buffer.from(' {"data":[{"b64_json":"'+image.toString('base64')+'"}]}\n');
  const calls:string[]=[];
  let editBody:Buffer|undefined;
  const transport:typeof requestBytes=async(url,options)=>{
    calls.push(url);
    let body:Buffer;
    if(url.endsWith('/images/generations'))body=imageReply;
    else if(url.endsWith('/images/edits')){editBody=options.body as Buffer;body=imageReply;}
    else if(url.endsWith('/video_generation'))body=Buffer.from(JSON.stringify({base_resp:{status_code:0},task_id:'12345'}));
    else if(url.includes('/query/video_generation'))body=Buffer.from(JSON.stringify({base_resp:{status_code:0},task_id:'12345',status:'Success',file_id:'67890'}));
    else if(url.includes('/files/retrieve'))body=Buffer.from(JSON.stringify({base_resp:{status_code:0},file:{file_id:'67890',download_url:'https://api.minimaxi.com/video.mp4'}}));
    else body=Buffer.alloc(0);
    return {status:200,headers:{},body,url};
  };
  try{
    const service=createModelMedia(root,transport),before=await service.configuration();
    const saved=await service.configure({image:{enabled:true,referenceEditing:false,baseUrl:'https://api.openai.com/v1',model:'image-fixture'},video:{enabled:true,baseUrl:'https://api.minimaxi.com/v1',model:'MiniMax-Hailuo-02'}},'image-secret','video-secret',before.revision);
    expect(saved).toMatchObject({hasImageKey:true,hasVideoKey:true});
    expect(JSON.stringify(saved)).not.toContain('secret');
    expect((await service.modelImage('画一张测试图',undefined,{size:'2048x1024'})).bytes).toEqual(imageReply);
    const editConfig={...saved,image:{...saved.image,referenceEditing:true}};
    await service.configure({image:editConfig.image,video:editConfig.video},undefined,undefined,saved.revision);
    expect((await service.modelImage('保留原图',{bytes:image,mime:'image/jpeg'})).bytes).toEqual(imageReply);
    expect(editBody?.includes(image)).toBe(true);
    expect(editBody?.includes(Buffer.from('image/jpeg'))).toBe(true);
    const submitted=await service.modelVideoSubmit('生成测试视频');
    expect(submitted.taskId).toBe('12345');
    const result=await service.modelVideoPoll(submitted.taskId,submitted.fingerprint);
    expect(result).toMatchObject({status:'completed',sourceUrl:'https://api.minimaxi.com/video.mp4'});
    expect(calls).not.toContain('https://api.minimaxi.com/video.mp4');
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
    expect(first).toMatchObject({hasImageKey:true,hasVideoKey:true,image:{enabled:true,baseUrl:config.image.baseUrl,model:config.image.model},video:{enabled:false,baseUrl:config.video.baseUrl,model:config.video.model}});
    expect(first).not.toHaveProperty('editing');expect(first).not.toHaveProperty('avatar');
    await rm(directory,{recursive:true});
    const second=await createModelMedia(root).configuration();
    expect(second).toMatchObject({hasImageKey:true,hasVideoKey:true,image:{enabled:true,baseUrl:config.image.baseUrl,model:config.image.model}});
  }finally{await rm(root,{recursive:true,force:true});}
});

it('routes one MiniMax connection to image and H3 video endpoints while preserving desktop parameters',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'lingfeng-aggregate-'));
  const seen:{url:string;body:any}[]=[];
  const transport:typeof requestBytes=async(url,options)=>{
    seen.push({url,body:options.body?JSON.parse(String(options.body)):null});
    const body=url.endsWith('/image_generation')?{base_resp:{status_code:0},data:{image_urls:['https://filecdn.minimax.chat/example.png']}}
      :url.endsWith('/v2/video_generation')?{task_id:'12345'}
      :{task:{task_id:'12345',status:'succeeded',content:{url:'https://filecdn.minimax.chat/example.mp4'}}};
    return {status:200,headers:{},body:Buffer.from(JSON.stringify(body)),url};
  };
  try{
    const service=createModelMedia(root,transport),connection={baseUrl:'https://api.minimax.io/v1',key:'single-key',imageModel:'image-01',videoModel:'MiniMax-H3'};
    const image=await service.modelImage('画一张主图',undefined,{aspect_ratio:'3:4'},connection);
    expect(JSON.parse(image.bytes.toString()).data.image_urls).toHaveLength(1);
    const submitted=await service.modelVideoSubmit('生成短片',{duration:8,resolution:'768P',ratio:'9:16'},connection);
    expect((await service.modelVideoPoll(submitted.taskId,submitted.fingerprint,connection)).status).toBe('completed');
    expect(seen[0]).toMatchObject({url:'https://api.minimax.io/v1/image_generation',body:{model:'image-01',prompt:'画一张主图',aspect_ratio:'3:4'}});
    expect(seen[1]).toMatchObject({url:'https://api.minimax.io/v2/video_generation',body:{model:'MiniMax-H3',duration:8,ratio:'9:16',content:[{type:'text',text:'生成短片'}]}});
    expect(seen[2].url).toBe('https://api.minimax.io/v2/query/video_generation/12345');
  }finally{await rm(root,{recursive:true,force:true});}
});
