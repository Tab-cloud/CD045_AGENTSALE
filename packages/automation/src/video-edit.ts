import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {FlowError} from './types';
const exec=promisify(execFile);
export const editPlanSchema=z.object({sourceId:z.string().uuid(),start:z.number().finite().min(0),end:z.number().finite().positive().max(180),aspect:z.enum(['original','portrait','square']),mute:z.boolean()}).strict();
export type EditPlan=z.infer<typeof editPlanSchema>;
export type VideoSource={id:string;name:string;duration:number;width:number;height:number;audio:boolean};
const ffmpeg=()=>process.env.LINGFENG_FFMPEG_PATH||'ffmpeg';
const ffprobe=()=>process.env.LINGFENG_FFPROBE_PATH||'ffprobe';
let available:Promise<boolean>|undefined;
export function editingAvailable(){return available??=Promise.all([exec(ffmpeg(),['-version'],{timeout:5000,maxBuffer:100000}),exec(ffprobe(),['-version'],{timeout:5000,maxBuffer:100000})]).then(()=>true,()=>false);}
export function createVideoEditor(directory:string){
  const file=(id:string,extension:string)=>path.join(directory,z.string().uuid().parse(id)+extension);
  async function load(id:string):Promise<VideoSource>{try{return JSON.parse(await readFile(file(id,'.json'),'utf8'));}catch{throw new FlowError('VIDEO_SOURCE','视频素材不存在或不属于当前账号');}}
  async function validate(raw:unknown){const plan=editPlanSchema.parse(raw),source=await load(plan.sourceId);if(plan.end>source.duration+0.05||plan.end-plan.start<0.2||plan.end-plan.start>60)throw new FlowError('VIDEO_RANGE','剪辑范围需位于素材内，每次导出 0.2–60 秒');return {plan,source};}
  return {
    validate,
    async importVideo(data:string,name:string){
      if(!await editingAvailable())throw new FlowError('VIDEO_ENGINE','平台尚未安装 FFmpeg / FFprobe，请联系管理员');
      if(data.length>26_666_668||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))throw new FlowError('VIDEO_INPUT','请选择不超过 20 MB 的 MP4/MOV 视频');
      const bytes=Buffer.from(data,'base64');if(bytes.length<12||bytes.length>20_000_000||bytes.subarray(4,8).toString()!=='ftyp')throw new FlowError('VIDEO_INPUT','请选择不超过 20 MB 的 MP4/MOV 视频');
      await mkdir(directory,{recursive:true,mode:0o700});
      if((await readdir(directory)).filter(f=>f.endsWith('.json')).length>=100)throw new FlowError('VIDEO_LIMIT','当前账号已保存 100 份视频素材，请复用已有任务');
      const id=randomUUID(),target=file(id,'.mp4');await writeFile(target,bytes,{mode:0o600,flag:'wx'});
      try{
        const {stdout}=await exec(ffprobe(),['-v','error','-protocol_whitelist','file','-f','mov','-show_streams','-show_format','-of','json',target],{timeout:10000,maxBuffer:100000});
        const meta=JSON.parse(stdout),video=meta.streams?.find((s:any)=>s.codec_type==='video'),duration=Number(meta.format?.duration);
        if(!video||!Number.isFinite(duration)||duration<=0||duration>180||video.width>4096||video.height>4096||!video.width||!video.height)throw new Error('limits');
        const result:VideoSource={id,name:name.slice(0,250),duration,width:video.width,height:video.height,audio:meta.streams.some((s:any)=>s.codec_type==='audio')};
        await writeFile(file(id,'.json'),JSON.stringify(result),{mode:0o600,flag:'wx'});return result;
      }catch{const {unlink}=await import('node:fs/promises');await unlink(target).catch(()=>{});throw new FlowError('VIDEO_INPUT','视频无法读取或超出限制：最长 3 分钟、最大 4096 像素');}
    },
    async render(raw:unknown,output:string){
      const {plan}=await validate(raw);
      const scale=plan.aspect==='portrait'?'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2':plan.aspect==='square'?'scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(ow-iw)/2:(oh-ih)/2':"scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2";
      // No shell or arbitrary model filters/paths: all parameters come from bounded typed fields.
      const args=['-hide_banner','-loglevel','error','-nostdin','-n','-protocol_whitelist','file','-ss',String(plan.start),'-f','mov','-i',file(plan.sourceId,'.mp4'),'-t',String(plan.end-plan.start),'-map','0:v:0','-vf',scale+',setsar=1','-r','30','-c:v','libx264','-preset','veryfast','-crf','23','-maxrate','4M','-bufsize','8M','-threads','2','-pix_fmt','yuv420p',...(plan.mute?['-an']:['-map','0:a:0?','-c:a','aac','-b:a','128k']),'-map_metadata','-1','-movflags','+faststart','-fs','50000000',output];
      try{await exec(ffmpeg(),args,{timeout:120000,killSignal:'SIGKILL',maxBuffer:100000});
        const {stdout}=await exec(ffprobe(),['-v','error','-show_entries','format=duration','-of','json',output],{timeout:10000,maxBuffer:100000});
        const duration=Number(JSON.parse(stdout).format?.duration);if(!Number.isFinite(duration)||Math.abs(duration-(plan.end-plan.start))>0.3)throw new Error('incomplete render');
      }catch{throw new FlowError('VIDEO_RENDER','视频导出失败或超时，请联系管理员检查剪辑服务');}
      return {mime:'video/mp4'};
    },
  };
}
