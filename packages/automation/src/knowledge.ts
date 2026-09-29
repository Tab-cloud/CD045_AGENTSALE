import {randomUUID,createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import type {Repository} from '@agentsale/database';
import {DomainError} from '@agentsale/domain';
import {parseKnowledgeFile} from './knowledge-parser';
export const libraryInput=z.object({name:z.string().trim().min(1).max(80),description:z.string().trim().max(500).default('')}).strict();
export function terms(text:string){
 const result=new Set<string>();
 for(const word of text.normalize('NFKC').toLowerCase().match(/[\p{Script=Han}]+|[\p{L}\p{N}_-]+/gu)||[]){
  if(/^\p{Script=Han}+$/u.test(word)){const chars=Array.from(word);for(let i=0;i<chars.length;i++){result.add(chars[i]);if(i+1<chars.length)result.add(chars[i]+chars[i+1]);}}
  else if(word.length<=80)result.add(word);
 }
 return [...result];
}
export function chunkText(text:string){const chars=Array.from(text),chunks:string[]=[];for(let i=0;i<chars.length;i+=880){chunks.push(chars.slice(i,i+1000).join(''));if(i+1000>=chars.length)break;}return chunks;}
const textArray=(values:string[])=>sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))`;
const missing=()=>new DomainError('NOT_FOUND','知识库或资料不存在',404);
export function createKnowledge(repo:Repository,workspace:string,userId:string){
 type Tx=Parameters<Parameters<Repository['scoped']>[1]>[0];
 async function library(tx:Tx,id:string,active=false){const row=(await tx.execute(sql`SELECT * FROM knowledge_libraries WHERE id=${id} AND user_id=${userId}`)).rows[0];if(!row||active&&row.archived)throw missing();return row;}
 const metadata=sql.raw('id,name,version,hash,chunk_count AS "chunkCount",archived,created_at AS "createdAt",updated_at AS "updatedAt"');
 async function list(){return repo.scoped(workspace,async tx=>(await tx.execute(sql`SELECT l.id,l.name,l.description,l.archived,l.updated_at AS "updatedAt",(SELECT count(*)::int FROM knowledge_documents d WHERE d.library_id=l.id AND d.user_id=${userId} AND NOT d.archived) AS "documentCount" FROM knowledge_libraries l WHERE l.user_id=${userId} ORDER BY l.updated_at DESC`)).rows);}
 async function create(raw:unknown){const b=libraryInput.parse(raw);return repo.scoped(workspace,async tx=>{await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);const n=Number((await tx.execute(sql`SELECT count(*) AS n FROM knowledge_libraries WHERE user_id=${userId}`)).rows[0].n);if(n>=20)throw new DomainError('LIBRARY_LIMIT','每个账号最多 20 个知识库（含归档）');const id=randomUUID(),at=new Date().toISOString();await tx.execute(sql`INSERT INTO knowledge_libraries VALUES(${id},${workspace},${userId},${b.name},${b.description},false,${at},${at})`);return {id,...b};});}
 async function update(id:string,raw:unknown){const b=libraryInput.extend({archived:z.boolean()}).parse(raw);return repo.scoped(workspace,async tx=>{await library(tx,id);await tx.execute(sql`UPDATE knowledge_libraries SET name=${b.name},description=${b.description},archived=${b.archived},updated_at=${new Date().toISOString()} WHERE id=${id} AND user_id=${userId}`);return {ok:true};});}
 async function documents(id:string){return repo.scoped(workspace,async tx=>{await library(tx,id);return (await tx.execute(sql`SELECT ${metadata} FROM knowledge_documents WHERE library_id=${id} AND user_id=${userId} ORDER BY updated_at DESC`)).rows;});}
 async function document(id:string,documentId:string){return repo.scoped(workspace,async tx=>{await library(tx,id);const d=(await tx.execute(sql`SELECT ${metadata},text FROM knowledge_documents WHERE id=${documentId} AND library_id=${id} AND user_id=${userId}`)).rows[0];if(!d)throw missing();return d;});}
 async function importFile(id:string,name:string,bytes:Buffer){
  name=z.string().trim().min(1).max(180).refine(s=>!/[\x00-\x1f/\\]/.test(s)).parse(name);
  await repo.scoped(workspace,tx=>library(tx,id,true));
  const text=await parseKnowledgeFile(name,bytes),hash=createHash('sha256').update(bytes).digest('hex'),chunks=chunkText(text);
  return repo.scoped(workspace,async tx=>{
   await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);await library(tx,id,true);
   const existing=(await tx.execute(sql`SELECT id,version,hash,archived FROM knowledge_documents WHERE library_id=${id} AND name=${name} AND user_id=${userId}`)).rows[0];
   if(existing?.hash===hash&&!existing.archived)return {id:existing.id,version:existing.version,unchanged:true,chunkCount:chunks.length};
   const n=Number((await tx.execute(sql`SELECT count(*) AS n FROM knowledge_documents WHERE library_id=${id} AND user_id=${userId}`)).rows[0].n);
   if(!existing&&n>=100)throw new DomainError('DOCUMENT_LIMIT','每个知识库最多 100 份资料（含归档）');
   const documentId=String(existing?.id||randomUUID()),version=Number(existing?.version||0)+1,at=new Date().toISOString();
   if(existing){await tx.execute(sql`DELETE FROM knowledge_chunks WHERE document_id=${documentId} AND user_id=${userId}`);await tx.execute(sql`UPDATE knowledge_documents SET version=${version},hash=${hash},text=${text},chunk_count=${chunks.length},archived=false,updated_at=${at} WHERE id=${documentId} AND user_id=${userId}`);}
   else await tx.execute(sql`INSERT INTO knowledge_documents VALUES(${documentId},${workspace},${userId},${id},${name},${version},${hash},${text},${chunks.length},false,${at},${at})`);
   for(const [ordinal,chunk] of chunks.entries())await tx.execute(sql`INSERT INTO knowledge_chunks VALUES(${randomUUID()},${workspace},${userId},${id},${documentId},${ordinal+1},${chunk},${textArray(terms(name+' '+chunk))})`);
   await tx.execute(sql`UPDATE knowledge_libraries SET updated_at=${at} WHERE id=${id} AND user_id=${userId}`);
   return {id:documentId,version,chunkCount:chunks.length,unchanged:false};
  });
 }
 async function archiveDocument(id:string,documentId:string,archived:boolean){return repo.scoped(workspace,async tx=>{await library(tx,id);const result=await tx.execute(sql`UPDATE knowledge_documents SET archived=${archived},updated_at=${new Date().toISOString()} WHERE id=${documentId} AND library_id=${id} AND user_id=${userId} RETURNING id`);if(!result.rows.length)throw missing();return {ok:true};});}
 async function search(id:string,query:string){
  const tokens=terms(z.string().trim().min(1).max(2000).parse(query)).slice(0,120);
  return repo.scoped(workspace,async tx=>{
   const lib=await library(tx,id,true);if(!tokens.length)return [];
   const hits=(await tx.execute(sql`SELECT c.id,c.document_id AS "documentId",c.ordinal,c.text,d.name,d.version,d.hash,d.updated_at AS "updatedAt",
    (SELECT count(*) FROM unnest(c.terms) term WHERE term=ANY(${textArray(tokens)}))::int AS score
    FROM knowledge_chunks c JOIN knowledge_documents d ON d.id=c.document_id
    WHERE c.library_id=${id} AND c.user_id=${userId} AND d.user_id=${userId} AND NOT d.archived AND c.terms && ${textArray(tokens)}
    ORDER BY score DESC,d.updated_at DESC,c.ordinal ASC LIMIT 30`)).rows;
   // Single common Chinese characters are weak evidence. Require a bigram/word when available.
   const significant=tokens.filter(t=>t.length>1);
   return hits.filter(h=>!significant.length||significant.some(t=>terms(String(h.name)+' '+String(h.text)).includes(t))).slice(0,6).map((h,i)=>({
    id:`S${i+1}`,title:String(h.name),url:`knowledge://${id}/${h.documentId}#${h.ordinal}`,snippet:String(h.text).slice(0,200),retrievedAt:new Date().toISOString(),
    knowledge:{libraryId:id,libraryName:String(lib.name),documentId:String(h.documentId),version:Number(h.version),chunk:Number(h.ordinal)},
    page:{title:String(h.name),url:`knowledge://${id}/${h.documentId}#${h.ordinal}`,text:String(h.text),hash:String(h.hash),fetchedAt:String(h.updatedAt),truncated:true}
   }));
  });
 }
 return {list,create,update,documents,document,importFile,archiveDocument,search};
}
