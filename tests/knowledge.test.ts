import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createRepository,type Repository} from '../packages/database/src/index';
import {createAuth} from '../packages/automation/src/auth';
import {createKnowledge,terms,chunkText} from '../packages/automation/src/knowledge';
import {parseKnowledgeFile} from '../packages/automation/src/knowledge-parser';
let repo:Repository;
beforeAll(async()=>{repo=await createRepository();},30000);afterAll(async()=>repo?.close());
async function setup(){const workspace=randomUUID(),auth=createAuth(repo,workspace),user=await auth.create('fixtureadmin','test-long-password','admin'),other=await auth.register('otheruser','test-long-password');return {workspace,user,other,kb:createKnowledge(repo,workspace,user.id),otherKb:createKnowledge(repo,workspace,other.id)};}
it('extracts real DOCX and PDF text in the bounded parser worker',async()=>{
 const docx=await readFile(new URL('./fixtures/knowledge/sample.docx',import.meta.url));expect(await parseKnowledgeFile('manual.docx',docx)).toContain('保修期限为十二个月');
 const pdf=await readFile(new URL('./fixtures/knowledge/sample.pdf',import.meta.url));expect(await parseKnowledgeFile('manual.pdf',pdf)).toContain('warranty twelve months');
});
it('rejects unsupported, corrupt, empty, non-UTF8 and oversized files',async()=>{
 for(const [name,data] of [['a.exe',Buffer.from('abc')],['a.pdf',Buffer.from('not pdf')],['a.docx',Buffer.from('a')],['a.txt',Buffer.from([255,255])],['a.md',Buffer.from('  ')],['a.txt',Buffer.alloc(4_000_001)],['a.txt',Buffer.from('x'.repeat(100001))]] as const)await expect(parseKnowledgeFile(name,data)).rejects.toThrow();
});
it('indexes Chinese and English with overlapping source chunks',()=>{
 expect(terms('聆风产品 WARRANTY-12')).toEqual(expect.arrayContaining(['聆风','产品','warranty-12']));const chunks=chunkText('甲'.repeat(999)+'Warranty'+'乙'.repeat(1000));expect(chunks[1]).toContain('Warranty');
});
it('imports searchable sources, updates versions atomically, and removes stale index entries',async()=>{
 const {kb}=await setup();const lib=await kb.create({name:'产品资料',description:'合成测试'});
 const first=await kb.importFile(lib.id,'产品手册.md',Buffer.from('蓝鲸支架采用铝合金材质。Warranty twelve months.'));
 expect(first).toMatchObject({version:1,chunkCount:1,unchanged:false});
 const results=await kb.search(lib.id,'蓝鲸支架 材质');expect(results).toHaveLength(1);expect(results[0].page.text).toContain('铝合金');expect(results[0].knowledge).toMatchObject({documentId:first.id,version:1,chunk:1});
 expect((await kb.importFile(lib.id,'产品手册.md',Buffer.from('蓝鲸支架采用铝合金材质。Warranty twelve months.'))).unchanged).toBe(true);
 const updated=await kb.importFile(lib.id,'产品手册.md',Buffer.from('红杉收纳盒为纸质材料。'));expect(updated).toMatchObject({id:first.id,version:2});expect(await kb.search(lib.id,'铝合金')).toHaveLength(0);expect((await kb.search(lib.id,'纸质'))[0].knowledge.version).toBe(2);
 expect(await kb.search(lib.id,'不存在的火星商品')).toHaveLength(0);
});
it('isolates library metadata, document content, imports and searches across accounts and workspaces',async()=>{
 const {kb,otherKb,user}=await setup(),lib=await kb.create({name:'私有知识库'}),doc=await kb.importFile(lib.id,'secret.txt',Buffer.from('私有产品规范'));
 expect(await otherKb.list()).toHaveLength(0);
 for(const op of [()=>otherKb.documents(lib.id),()=>otherKb.document(lib.id,String(doc.id)),()=>otherKb.importFile(lib.id,'x.txt',Buffer.from('x')),()=>otherKb.search(lib.id,'产品'),()=>otherKb.update(lib.id,{name:'改名',archived:false}),()=>otherKb.archiveDocument(lib.id,String(doc.id),true)])await expect(op()).rejects.toMatchObject({status:404});
 const wrongWorkspace=createKnowledge(repo,randomUUID(),user.id);expect(await wrongWorkspace.list()).toHaveLength(0);await expect(wrongWorkspace.search(lib.id,'规范')).rejects.toMatchObject({status:404});
});
it('archives exclude documents from retrieval and restoration restores their evidence',async()=>{
 const {kb}=await setup(),lib=await kb.create({name:'售后'}),doc=await kb.importFile(lib.id,'售后.txt',Buffer.from('保修期限十二个月'));
 await kb.archiveDocument(lib.id,String(doc.id),true);expect(await kb.search(lib.id,'保修期限')).toHaveLength(0);expect((await kb.document(lib.id,String(doc.id))).text).toContain('十二个月');
 await kb.archiveDocument(lib.id,String(doc.id),false);expect(await kb.search(lib.id,'保修期限')).toHaveLength(1);
 await kb.update(lib.id,{name:'售后',description:'',archived:true});await expect(kb.search(lib.id,'保修')).rejects.toMatchObject({status:404});await kb.update(lib.id,{name:'售后',description:'',archived:false});expect(await kb.search(lib.id,'保修')).toHaveLength(1);
});
it('serializes simultaneous updates without duplicate names or lost version numbers',async()=>{
 const {kb}=await setup(),lib=await kb.create({name:'并发更新'});
 await Promise.all([kb.importFile(lib.id,'v.txt',Buffer.from('alpha content')),kb.importFile(lib.id,'v.txt',Buffer.from('beta content'))]);
 const docs=await kb.documents(lib.id);expect(docs).toHaveLength(1);expect(docs[0].version).toBe(2);
});
