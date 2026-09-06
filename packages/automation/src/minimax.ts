import { z } from 'zod';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { requestBytes } from './network';
import { artifact,ownedFile,hash,command } from './media';
import { FlowError,type SecretSettings,type Job,type Asset } from './types';

type Transport=typeof requestBytes;
const identifier=z.string().regex(/^\d{1,64}$/);
export function assertMinimax(s:SecretSettings,service:'speech'|'video'){
  if(!s.minimaxKey||s.minimax[service==='speech'?'speechLimitCents':'videoLimitCents']<1||s.dailyLimitCents<1)throw new FlowError('MINIMAX_UNCONFIGURED','请管理员配置 MiniMax 多媒体密钥及对应调用额度');
}
// Transport injection is for protocol tests only. App configuration cannot override network checks.
export function createMinimax(transport:Transport=requestBytes){
  async function api(s:SecretSettings,route:string,body?:unknown){
    const response=await transport(s.minimax.baseUrl+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+s.minimaxKey,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),trustedMiniMax:true,timeout:120000,maxBytes:20_000_000});
    if(response.status!==200)throw new FlowError('MINIMAX_HTTP','MiniMax 返回 '+response.status+'，请检查账号权限、额度和参数');
    let data:any;try{data=JSON.parse(response.body.toString());}catch{throw new FlowError('MINIMAX_RESPONSE','MiniMax 响应格式无效');}
    if(data.base_resp?.status_code!==0)throw new FlowError('MINIMAX_REJECTED','MiniMax 拒绝该请求，错误码 '+String(data.base_resp?.status_code??'unknown').slice(0,12));
    return data;
  }
  async function speech(root:string,job:Job,s:SecretSettings){
    assertMinimax(s,'speech');const text=job.copy?.narration||job.copy?.scenes.map(scene=>scene.caption).join(' ');if(!text||text.length>600)throw new FlowError('SPEECH_TEXT','请提供 600 字符以内的配音文字');
    const result=await api(s,'/t2a_v2',{model:s.minimax.speechModel,text,stream:false,voice_setting:{voice_id:s.minimax.voiceId,speed:1,vol:1,pitch:0},audio_setting:{sample_rate:32000,bitrate:128000,format:'mp3',channel:1},output_format:'hex'});
    const hex=result.data?.audio;if(result.data?.status!==2||typeof hex!=='string'||!hex.length||hex.length%2||!/^[\da-f]+$/i.test(hex))throw new FlowError('SPEECH_RESPONSE','未收到完整的语音音频');
    const file='jobs/'+job.id+'/voiceover.mp3',target=ownedFile(root,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,Buffer.from(hex,'hex'));
    const probe=JSON.parse(await command(process.env.AGENTSALE_FFPROBE||'ffprobe',['-v','error','-show_format','-show_streams','-of','json',target]));
    if(!probe.streams?.some((v:any)=>v.codec_type==='audio')||Number(probe.format.duration)>60)throw new FlowError('SPEECH_DURATION','配音超过 60 秒或音频无效，请缩短文案');
    await command(process.env.AGENTSALE_FFMPEG||'ffmpeg',['-v','error','-i',target,'-f','null','-']);
    return {artifact:await artifact(root,file,'audio/mpeg'),usage:{characters:result.extra_info?.usage_characters,durationMs:result.extra_info?.audio_length}};
  }
  async function submit(root:string,job:Job,asset:Asset,s:SecretSettings){
    assertMinimax(s,'video');if(asset.productId!==job.productId)throw new FlowError('ASSET_PRODUCT_MISMATCH','图片不属于当前商品');
    const bytes=await readFile(ownedFile(root,asset.file));if(hash(bytes)!==asset.hash)throw new FlowError('ASSET_CHANGED','图片已变化，请重新上传');
    const frame=await sharp(bytes).resize(720,1280,{fit:'contain',background:'#ffffff'}).png().toBuffer();
    const prompt=job.copy?.videoPrompt||'Slow camera movement around the supplied product. Preserve exact shape, material and color. No new parts, claims, people or text.';
    const result=await api(s,'/video_generation',{model:s.minimax.videoModel,prompt,first_frame_image:'data:image/png;base64,'+frame.toString('base64'),duration:6,resolution:'768P',prompt_optimizer:false});
    const id=identifier.safeParse(result.task_id);if(!id.success)throw new FlowError('VIDEO_SUBMIT_UNKNOWN','未取得有效视频任务号，请到 MiniMax 核对，不能直接重复提交');
    return {taskId:id.data,endpoint:s.minimax.baseUrl,status:'Submitted',submittedAt:new Date().toISOString()};
  }
  async function poll(root:string,job:Job,s:SecretSettings){
    const remote=job.remoteVideo;if(!remote?.taskId)throw new FlowError('VIDEO_TASK_UNKNOWN','视频提交结果未知，请填写 MiniMax 后台的任务号后恢复');
    if(!s.minimaxKey||remote.endpoint!==s.minimax.baseUrl)throw new FlowError('VIDEO_ACCOUNT_CHANGED','请恢复提交该视频时的 MiniMax 服务地址与账号后查询');
    const result=await api(s,'/query/video_generation?task_id='+identifier.parse(remote.taskId));
    if(String(result.task_id)!==remote.taskId)throw new FlowError('VIDEO_TASK_MISMATCH','返回的视频任务号不匹配');
    if(['Preparing','Queueing','Processing'].includes(result.status))return {pending:true as const,status:result.status as string};
    if(result.status!=='Success')throw new FlowError('VIDEO_REMOTE_FAILED','海螺视频未成功，原任务号已保留；重新生成需创建新流程');
    const fileId=identifier.parse(result.file_id),file=await api(s,'/files/retrieve?file_id='+fileId);
    if(String(file.file?.file_id)!==fileId||typeof file.file?.download_url!=='string')throw new FlowError('VIDEO_FILE_INVALID','视频文件信息无效');
    // Download without credentials; public-address validation applies to every redirect.
    if(!file.file.download_url.startsWith('https://'))throw new FlowError('VIDEO_DOWNLOAD_URL','视频下载地址必须使用 HTTPS');
    const download=await transport(file.file.download_url,{trustedMiniMax:true,timeout:120000,maxBytes:100_000_000});
    if(download.status!==200)throw new FlowError('VIDEO_DOWNLOAD','视频下载未完成，可继续查询原任务');
    const relative='jobs/'+job.id+'/hailuo-source.mp4',target=ownedFile(root,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,download.body);
    const probe=JSON.parse(await command(process.env.AGENTSALE_FFPROBE||'ffprobe',['-v','error','-show_format','-show_streams','-of','json',target]));
    if(!probe.streams?.some((v:any)=>v.codec_type==='video'&&v.width>=300&&v.height>=300)||!Number.isFinite(Number(probe.format?.duration))||Number(probe.format.duration)<1||Number(probe.format.duration)>20)throw new FlowError('VIDEO_MEDIA_INVALID','海螺视频未通过媒体检测');
    await command(process.env.AGENTSALE_FFMPEG||'ffmpeg',['-v','error','-i',target,'-f','null','-']);
    return {pending:false as const,status:'Success',fileId,artifact:await artifact(root,relative,'video/mp4')};
  }
  return {speech,submit,poll};
}
