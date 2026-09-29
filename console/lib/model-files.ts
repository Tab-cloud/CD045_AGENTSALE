import {createReadStream} from 'node:fs';
import {mkdir,readdir,rename,stat,unlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {modelRoot} from './local-runtime';

const mimeExtension={'image/png':'png','video/mp4':'mp4','audio/mpeg':'mp3'} as const;
type Mime=keyof typeof mimeExtension;
async function folder(owner:string){return path.join(modelRoot(),'model-results',z.string().uuid().parse(owner));}
async function name(owner:string,id:string,mime:Mime){return path.join(await folder(owner),z.string().uuid().parse(id)+'.'+mimeExtension[mime]);}

export async function storeModelFile(owner:string,id:string,mime:Mime,bytes:Buffer){
  const directory=await folder(owner),target=await name(owner,id,mime);
  await mkdir(directory,{recursive:true,mode:0o700});
  const temp=target+'.'+randomUUID();
  await writeFile(temp,bytes,{mode:0o600});
  await rename(temp,target);
  // Results are a transfer cache. Preserve request metadata to prevent replay after expiry.
  const expiry=Date.now()-7*86400_000;
  for(const file of await readdir(directory)){
    if(!/^[\da-f-]{36}\.(png|mp4|mp3)$/.test(file))continue;
    const candidate=path.join(directory,file);
    if((await stat(candidate)).mtimeMs<expiry)await unlink(candidate).catch(()=>{});
  }
}
export async function streamModelFile(owner:string,id:string,mime:Mime){
  const filename=await name(owner,id,mime);
  await stat(filename);
  return createReadStream(filename);
}
