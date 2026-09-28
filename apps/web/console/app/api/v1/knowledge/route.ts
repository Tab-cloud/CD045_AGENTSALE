import {z} from 'zod';
import {DomainError} from '@agentsale/domain';
import {LOCAL_WORKSPACE} from '@agentsale/database';
import {createKnowledge,libraryInput} from '../../../../../packages/automation/src/knowledge';
import {MAX_DOCUMENT_BYTES} from '../../../../../packages/automation/src/knowledge-parser';
import {session,platform} from '../../../../lib/platform';
import {failure,getRepository} from '../../../../lib/local-runtime';
import {jsonBody} from '../../../../lib/server-access';
export const runtime='nodejs';export const dynamic='force-dynamic';
const id=z.string().uuid();
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('list')}).strict(),
 z.object({action:z.literal('create'),...libraryInput.shape}).strict(),
 z.object({action:z.literal('update'),libraryId:id,...libraryInput.shape,archived:z.boolean()}).strict(),
 z.object({action:z.literal('documents'),libraryId:id}).strict(),
 z.object({action:z.literal('document'),libraryId:id,documentId:id}).strict(),
 z.object({action:z.literal('import'),libraryId:id,name:z.string().min(1).max(180),data:z.string().min(4).max(Math.ceil(MAX_DOCUMENT_BYTES/3)*4).regex(/^[A-Za-z0-9+/]*={0,2}$/).refine(s=>s.length%4===0)}).strict(),
 z.object({action:z.literal('archiveDocument'),libraryId:id,documentId:id,archived:z.boolean()}).strict(),
 z.object({action:z.literal('search'),libraryId:id,query:z.string().trim().min(1).max(2000)}).strict()
]);
export async function POST(request:Request){try{
 const user=await session(request,true),body=schema.parse(await jsonBody(request,5_400_000));
 const kb=createKnowledge(await getRepository(),LOCAL_WORKSPACE,user.id),p=await platform();
 let result:unknown;
 if(body.action==='list')result={libraries:await kb.list()};
 else if(body.action==='documents')result={documents:await kb.documents(body.libraryId)};
 else if(body.action==='document')result={document:await kb.document(body.libraryId,body.documentId)};
 else if(body.action==='archiveDocument')result=await kb.archiveDocument(body.libraryId,body.documentId,body.archived);
 else if(body.action==='update')result=await kb.update(body.libraryId,{name:body.name,description:body.description,archived:body.archived});
 else{
  await p.members.requireFeature(user.id,'search');
  if(body.action==='create')result=await kb.create({name:body.name,description:body.description});
  else if(body.action==='import')result=await kb.importFile(body.libraryId,body.name,Buffer.from(body.data,'base64'));
  else {await kb.documents(body.libraryId);await p.members.consume(user.id,'search');result={sources:await kb.search(body.libraryId,body.query)};}
 }
 return Response.json(result,{headers:{'Cache-Control':'no-store'}});
}catch(e){if(e instanceof z.ZodError)return Response.json({message:'知识库参数无效，请检查名称、文件或查询内容'},{status:400});return failure(DomainError.is(e)?e:new DomainError('KNOWLEDGE_FAILED','资料处理失败，请稍后重试；原有资料保持不变',500));}}
