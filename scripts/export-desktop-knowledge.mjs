import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {writeFile,rename,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function buildKnowledgeArchive(db,userId,platformUrl){
  if(!uuid.test(userId))throw new Error('用户编号无效');
  const url=new URL(platformUrl);
  if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('平台地址须为 HTTPS 根地址');
  const owner=url.origin+':'+userId;
  const libraries=(await db.query('SELECT id,name,description,archived,updated_at FROM knowledge_libraries WHERE user_id=$1 ORDER BY id',[userId])).rows;
  const documents=(await db.query('SELECT id,library_id,name,version,hash,text,archived,updated_at FROM knowledge_documents WHERE user_id=$1 ORDER BY id',[userId])).rows;
  if(libraries.length>20||documents.length>2000||documents.reduce((n,d)=>n+Buffer.byteLength(d.text),0)>50_000_000)throw new Error('知识资料超过桌面备份格式的限制，请先整理资料');
  const ids=new Set(libraries.map(row=>String(row.id)));
  if(documents.some(row=>!ids.has(String(row.library_id))))throw new Error('资料归属的知识库不存在');
  return {format:'lingfeng-workspace',version:2,owner,createdAt:new Date().toISOString(),runs:[],files:[],knowledge:{
    libraries:libraries.map(row=>({id:String(row.id),name:String(row.name),description:String(row.description),archived:Boolean(row.archived),updatedAt:String(row.updated_at)})),
    documents:documents.map(row=>({id:String(row.id),libraryId:String(row.library_id),name:String(row.name),version:Number(row.version),hash:String(row.hash),text:String(row.text),archived:Boolean(row.archived),updatedAt:String(row.updated_at)}))
  }};
}
async function main(){
  const values=Object.fromEntries(process.argv.slice(2).map(arg=>{const m=/^--([a-z-]+)=(.+)$/.exec(arg);if(!m)throw new Error('参数须使用 --名称=值');return [m[1],m[2]];}));
  for(const name of ['data-dir','user-id','platform-url','output'])if(!values[name])throw new Error('缺少 --'+name);
  const target=resolve(values.output),db=new PGlite(resolve(values['data-dir']));
  try{
    const archive=await buildKnowledgeArchive(db,values['user-id'],values['platform-url']);
    const temporary=target+'.'+randomUUID()+'.tmp';
    try{await writeFile(temporary,JSON.stringify(archive),{flag:'wx',mode:0o600});await rename(temporary,target);}
    finally{await rm(temporary,{force:true}).catch(()=>{});}
    process.stdout.write(`已导出 ${archive.knowledge.libraries.length} 个知识库、${archive.knowledge.documents.length} 份资料至 ${target}\n`);
  }finally{await db.close();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(error=>{process.stderr.write('导出失败：'+error.message+'\n');process.exitCode=1;});
