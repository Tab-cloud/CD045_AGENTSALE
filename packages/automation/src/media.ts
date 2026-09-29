import sharp from 'sharp';
import { spawn } from 'node:child_process';
import { mkdir,writeFile,readFile,stat,copyFile } from 'node:fs/promises';
import { randomUUID,createHash } from 'node:crypto';
import path from 'node:path';
import { FlowError,type Asset,type Job,type Copy } from './types';
import { listingDocuments } from './content-media';

export const hash=(buffer:Buffer|string)=>createHash('sha256').update(buffer).digest('hex');
export function ownedFile(root:string,relative:string){const resolved=path.resolve(root,relative);if(!resolved.startsWith(path.resolve(root)+path.sep))throw new FlowError('PATH_REJECTED','文件路径无效');return resolved;}
export function command(executable:string,args:string[],cwd?:string,timeout=90000):Promise<string>{
  return new Promise((resolve,reject)=>{const child=spawn(executable,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});let out='',error='';child.stdout.on('data',c=>{if(out.length<1_000_000)out+=c;});child.stderr.on('data',c=>{error=(error+c).slice(-4000);});const timer=setTimeout(()=>child.kill(),timeout);child.on('error',()=>reject(new FlowError('MEDIA_TOOL_UNAVAILABLE','请在本机安装 FFmpeg 和 ffprobe，并加入服务的 PATH')));child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(out);else reject(new FlowError('MEDIA_FAILED','视频处理失败或超时，请检查图片、字体和编码工具'));});});
}
export async function mediaHealth(){try{await command(process.env.AGENTSALE_FFMPEG||'ffmpeg',['-version'],undefined,5000);await command(process.env.AGENTSALE_FFPROBE||'ffprobe',['-version'],undefined,5000);return true;}catch{return false;}}
export async function saveAsset(root:string,workspaceId:string,productId:string,name:string,rights:string,bytes:Buffer):Promise<Asset>{
  if(bytes.length>10_000_000||bytes.length<32)throw new FlowError('IMAGE_SIZE','图片需小于 10 MB');
  if(!rights.trim()||rights.length>500)throw new FlowError('RIGHTS_REQUIRED','请记录素材权利来源');
  let image;try{image=sharp(bytes,{limitInputPixels:25_000_000,failOn:'warning'});const metadata=await image.metadata();if(!['jpeg','png','webp'].includes(metadata.format||'')||(metadata.pages||1)>1)throw new Error();}catch{throw new FlowError('IMAGE_INVALID','仅支持有效的单帧 JPEG、PNG、WebP 图片');}
  const id=randomUUID(),file='assets/'+id+'.png',target=ownedFile(root,file);await mkdir(path.dirname(target),{recursive:true});
  const normalized=await image.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).png().toBuffer();await writeFile(target,normalized,{flag:'wx'});
  return {id,workspaceId,productId,name:name.slice(0,150),file,hash:hash(normalized),rights,createdAt:new Date().toISOString()};
}
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
function lines(s:string,max:number){const result:string[]=[];let row='',width=0;const measure=(v:string)=>Array.from(v).reduce((n,c)=>n+(c.charCodeAt(0)>255?2:1),0);for(const char of s.replace(/\s+/g,' ')){const n=char.charCodeAt(0)>255?2:1;if(width+n>max){const split=row.lastIndexOf(' ');if(split>row.length/2){result.push(row.slice(0,split));row=row.slice(split+1);width=measure(row);}else{result.push(row);row='';width=0;}}row+=char;width+=n;}if(row.trim())result.push(row.trim());return result;}
function textSvg(title:string,caption:string,index:number){
  const heading=lines(title,27),body=lines(caption,42);
  if(heading.length>4||body.length>5)throw new FlowError('COPY_TOO_LONG','分镜文字超过画面可容纳的行数，请修订并缩短标题或字幕后重新生成');
  return Buffer.from(`<svg width="720" height="1280" xmlns="http://www.w3.org/2000/svg"><g font-family="Microsoft YaHei,Segoe UI,sans-serif" fill="#1d1d1f"><text x="54" y="70" font-size="18" fill="#6e6e73">${String(index+1).padStart(2,'0')} / 03</text>${heading.map((line,i)=>`<text x="54" y="${140+i*55}" font-size="42" font-weight="600">${escape(line)}</text>`).join('')}${body.map((line,i)=>`<text x="54" y="${1040+i*32}" font-size="26">${escape(line)}</text>`).join('')}<text x="54" y="1232" font-size="18" fill="#6e6e73">DRAFT · FOR REVIEW</text></g></svg>`);
}
export async function artifact(root:string,file:string,mime:string,name=path.basename(file)){const absolute=ownedFile(root,file),bytes=await readFile(absolute);return {file,name,mime,bytes:bytes.length,hash:hash(bytes)};}
export async function renderVideo(root:string,job:Job,asset:Asset){
  if(!job.copy)throw new FlowError('COPY_REQUIRED','请先生成或提供分镜文案');
  if(asset.productId!==job.productId)throw new FlowError('ASSET_PRODUCT_MISMATCH','素材不属于当前商品');
  const data=await readFile(ownedFile(root,asset.file));if(hash(data)!==asset.hash)throw new FlowError('ASSET_CHANGED','素材文件已变化，请重新上传');
  const relative='jobs/'+job.id,dir=ownedFile(root,relative);await mkdir(dir,{recursive:true});
  const photo=await sharp(data).resize(612,620,{fit:'contain',background:'#f5f5f7'}).png().toBuffer();
  for(let i=0;i<3;i++){const scene=job.copy.scenes[i];await sharp({create:{width:720,height:1280,channels:4,background:'#ffffff'}}).composite([{input:photo,left:54,top:360},{input:textSvg(scene.headline,scene.caption,i),left:0,top:0}]).png().toFile(path.join(dir,'scene-'+i+'.png'));}
  const ffmpeg=process.env.AGENTSALE_FFMPEG||'ffmpeg';
  await command(ffmpeg,['-hide_banner','-loglevel','error','-y','-framerate','1/5','-i','scene-%d.png','-vf','fps=24,format=yuv420p','-t','15','-c:v','libx264','-preset','fast','-crf','22','-movflags','+faststart','video.mp4'],dir,120000);
  const probe=JSON.parse(await command(process.env.AGENTSALE_FFPROBE||'ffprobe',['-v','error','-show_streams','-show_format','-of','json','video.mp4'],dir));
  const video=probe.streams?.find((s:any)=>s.codec_type==='video');if(video?.codec_name!=='h264'||video?.width!==720||video?.height!==1280||Math.abs(Number(probe.format?.duration)-15)>0.2)throw new FlowError('VIDEO_QA_FAILED','视频尺寸、编码或时长检查未通过');
  await command(ffmpeg,['-v','error','-i','video.mp4','-f','null','-'],dir);
  const srt=job.copy.scenes.map((s,i)=>`${i+1}\n00:00:${String(i*5).padStart(2,'0')},000 --> 00:00:${String((i+1)*5).padStart(2,'0')},000\n${s.headline}\n${s.caption}\n`).join('\n');
  await writeFile(path.join(dir,'captions.srt'),srt);await writeFile(path.join(dir,'media-check.json'),JSON.stringify({codec:'h264',width:720,height:1280,durationSeconds:Number(probe.format.duration),decoded:true,audio:'none',assetId:asset.id,assetHash:asset.hash,rights:asset.rights},null,2));
  return Promise.all([artifact(root,relative+'/video.mp4','video/mp4'),artifact(root,relative+'/captions.srt','text/plain'),artifact(root,relative+'/media-check.json','application/json')]);
}
export async function packageFiles(root:string,job:Job){
  const prefix='jobs/'+job.id,dir=ownedFile(root,prefix);await mkdir(dir,{recursive:true});
  const documents:Record<string,string>={...listingDocuments(job)};
  if(job.research){documents['supplier-review.json']=JSON.stringify(job.research,null,2);documents['supplier-inquiry.txt']=job.research.inquiry.subject+'\n\n'+job.research.inquiry.body+'\n\n[草稿，尚未发送]';}
  if(job.copy)documents['social-post.txt']=job.copy.title+'\n\n'+job.copy.caption+'\n\n'+job.copy.hashtags.join(' ')+'\n\n[Draft, not published]';
  documents['sources.json']=JSON.stringify(job.sources,null,2);
  documents['README.txt']='AgentSale 自动化产物\n所有文案和视频均待人工审阅，未发送询价、发布或交易。\n来源是网页声明，未完成独立工厂和实物核验。\n视频与配音以 media-check.json 为准；海报保留上传商品图，AI 动态画面需核对实物一致性。\n按供应商发货证据选择市场，证据不足时不作确定推荐。\n';
  const files=[...job.artifacts];for(const [name,content] of Object.entries(documents)){await writeFile(path.join(dir,name),content);files.push(await artifact(root,prefix+'/'+name,name.endsWith('.json')?'application/json':name.endsWith('.html')?'text/html':'text/plain'));}
  await writeFile(path.join(dir,'manifest.json'),JSON.stringify({jobId:job.id,productVersion:job.productVersion,review:'pending',files,createdAt:new Date().toISOString()},null,2));files.push(await artifact(root,prefix+'/manifest.json','application/json'));
  return files;
}
