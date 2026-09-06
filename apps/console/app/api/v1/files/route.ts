import { readFile } from 'node:fs/promises';
import { failure,getAutomation } from '../../../../lib/local-runtime';
import { access } from '../../../../lib/server-access';
import { ownedFile } from '@agentsale/automation';
import { DomainError } from '@agentsale/domain';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){try{await access(request);const query=new URL(request.url).searchParams,engine=await getAutomation();let file:string|undefined,mime='application/octet-stream',name='download';
  if(query.has('asset')){const asset=(await engine.store.assets()).find(a=>a.id===query.get('asset'));if(asset){file=asset.file;mime='image/png';name=asset.name;}}
  else {const job=await engine.store.get(query.get('job')||''),artifact=job.artifacts.find(a=>a.name===query.get('name'));if(artifact){file=artifact.file;mime=artifact.mime;name=artifact.name;}}
  if(!file)throw new DomainError('NOT_FOUND','文件不存在或不属于当前工作区',404);const bytes=await readFile(ownedFile(engine.root,file));
  const headers={'Content-Type':mime,'Content-Disposition':`${mime.startsWith('video/')||mime.startsWith('image/')||mime.startsWith('audio/')?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'private, no-store','Accept-Ranges':'bytes'};
  const range=request.headers.get('range');if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${bytes.length}`}});const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1;if(start>end||start>=bytes.length)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${bytes.length}`}});return new Response(bytes.subarray(start,end+1),{status:206,headers:{...headers,'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':String(end-start+1)}});}
  return new Response(bytes,{headers:{...headers,'Content-Length':String(bytes.length)}});
}catch(e){return failure(e);}}
