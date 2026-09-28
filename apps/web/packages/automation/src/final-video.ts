import { writeFile,readFile,rename } from 'node:fs/promises';
import sharp from 'sharp';
import { command,ownedFile,artifact,renderVideo } from './media';
import { FlowError,type Job,type Asset } from './types';

export async function renderFinalVideo(root:string,job:Job,asset:Asset){
  const remote=job.input.videoMode==='minimax',voice=job.artifacts.find(a=>a.name==='voiceover.mp3');
  if(!remote&&!voice)return renderVideo(root,job,asset);
  const dir=ownedFile(root,'jobs/'+job.id),ffmpeg=process.env.AGENTSALE_FFMPEG||'ffmpeg',probeCommand=process.env.AGENTSALE_FFPROBE||'ffprobe';
  let duration=remote?6:15;
  if(voice){const info=JSON.parse(await command(probeCommand,['-v','error','-show_format','-of','json',ownedFile(root,voice.file)]));duration=Math.max(duration,Math.ceil(Number(info.format.duration)));}
  if(!Number.isFinite(duration)||duration>60)throw new FlowError('VIDEO_DURATION','视频时长超出范围，请缩短配音');
  if(!remote)await renderVideo(root,job,asset);
  const source=remote?job.artifacts.find(a=>a.name==='hailuo-source.mp4')?.file:`jobs/${job.id}/video.mp4`;
  if(!source)throw new FlowError('VIDEO_SOURCE_REQUIRED','海螺原始视频尚未下载');
  const overlay=Buffer.from(`<svg width="720" height="1280" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="1210" width="720" height="70" fill="white" fill-opacity="0.8"/><text x="36" y="1254" font-size="20" font-family="Arial" fill="#333">${remote?'AI VIDEO · ':''}DRAFT · FOR REVIEW</text></svg>`);
  await sharp(overlay).png().toFile(dir+'/video-overlay.png');
  const args=['-hide_banner','-loglevel','error','-y','-i',ownedFile(root,source),'-i','video-overlay.png',...(voice?['-i',ownedFile(root,voice.file)]:[])];
  args.push('-filter_complex',`[0:v]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,tpad=stop_mode=clone:stop_duration=60[base];[base][1:v]overlay=0:0,fps=24,format=yuv420p[v]`,'-map','[v]',...(voice?['-map','2:a:0','-af','apad','-c:a','aac']:['-an']),'-t',String(duration),'-c:v','libx264','-preset','fast','-crf','22','-movflags','+faststart','video-final.mp4');
  await command(ffmpeg,args,dir,120000);await command(ffmpeg,['-v','error','-i','video-final.mp4','-f','null','-'],dir);
  const probe=JSON.parse(await command(probeCommand,['-v','error','-show_format','-show_streams','-of','json','video-final.mp4'],dir));
  if(!probe.streams.some((s:any)=>s.codec_type==='video'&&s.codec_name==='h264'&&s.width===720&&s.height===1280)||Math.abs(Number(probe.format.duration)-duration)>0.3||(!!voice!==probe.streams.some((s:any)=>s.codec_type==='audio')))throw new FlowError('VIDEO_QA_FAILED','最终视频或配音未通过媒体检查');
  await rename(dir+'/video-final.mp4',dir+'/video.mp4');
  const time=(seconds:number)=>{const ms=Math.round(seconds*1000);return '00:'+String(Math.floor(ms/60000)).padStart(2,'0')+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+','+String(ms%1000).padStart(3,'0');};
  await writeFile(dir+'/captions.srt',job.copy!.scenes.map((s,i)=>`${i+1}\n${time(i*duration/3)} --> ${time((i+1)*duration/3)}\n${s.headline}\n${s.caption}\n`).join('\n'));
  await writeFile(dir+'/media-check.json',JSON.stringify({codec:'h264',width:720,height:1280,durationSeconds:duration,decoded:true,audio:voice?'MiniMax speech':'none',video:remote?'MiniMax Hailuo + local formatting':'local slideshow',subtitleTiming:'three equal sections; not speech alignment',tailHold:voice&&duration>(remote?6:15),assetId:asset.id,rights:asset.rights},null,2));
  return Promise.all([artifact(root,`jobs/${job.id}/video.mp4`,'video/mp4'),artifact(root,`jobs/${job.id}/captions.srt`,'text/plain'),artifact(root,`jobs/${job.id}/media-check.json`,'application/json')]);
}
