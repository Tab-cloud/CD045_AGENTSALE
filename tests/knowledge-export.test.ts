import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createRepository} from '../packages/database/src/index';
import {createAuth} from '../packages/automation/src/auth';
import {buildKnowledgeArchive} from '../scripts/export-desktop-knowledge.mjs';

describe('one-time knowledge export',()=>{
 it('exports only the selected account in the desktop backup contract',async()=>{
  const repo=await createRepository(),workspace=randomUUID();
  try{
   await repo.db.$client.exec(`
     CREATE TABLE knowledge_libraries(id uuid PRIMARY KEY,workspace_id text NOT NULL,user_id uuid NOT NULL,name text NOT NULL,description text NOT NULL,archived boolean NOT NULL,created_at text NOT NULL,updated_at text NOT NULL);
     CREATE TABLE knowledge_documents(id uuid PRIMARY KEY,workspace_id text NOT NULL,user_id uuid NOT NULL,library_id uuid NOT NULL,name text NOT NULL,version integer NOT NULL,hash text NOT NULL,text text NOT NULL,chunk_count integer NOT NULL,archived boolean NOT NULL,created_at text NOT NULL,updated_at text NOT NULL);
   `);
   const auth=createAuth(repo,workspace);await auth.create('administrator','test-long-password','admin');const first=await auth.register('first','test-long-password'),second=await auth.register('second','test-long-password');
   const client=repo.db.$client,libraryId=randomUUID(),otherId=randomUUID();
   await client.query('INSERT INTO knowledge_libraries VALUES ($1,$2,$3,$4,$5,false,$6,$6)',[libraryId,workspace,first.id,'产品资料','',new Date().toISOString()]);
   await client.query('INSERT INTO knowledge_libraries VALUES ($1,$2,$3,$4,$5,false,$6,$6)',[otherId,workspace,second.id,'私有资料','',new Date().toISOString()]);
   await client.query('INSERT INTO knowledge_documents VALUES ($1,$2,$3,$4,$5,1,$6,$7,1,false,$8,$8)',[randomUUID(),workspace,first.id,libraryId,'fact.md','a'.repeat(64),'只导出本账号的正文',new Date().toISOString()]);
   await client.query('INSERT INTO knowledge_documents VALUES ($1,$2,$3,$4,$5,1,$6,$7,1,false,$8,$8)',[randomUUID(),workspace,second.id,otherId,'secret.md','b'.repeat(64),'不能进入其他账号备份',new Date().toISOString()]);
   const archive=await buildKnowledgeArchive(repo.db.$client,first.id,'https://lingfeng.zailink.space');
   expect(archive.owner).toBe('https://lingfeng.zailink.space:'+first.id);
   expect(archive.version).toBe(2);
   expect(archive.knowledge.libraries).toHaveLength(1);
   expect(archive.knowledge.documents).toHaveLength(1);
   expect(archive.knowledge.documents[0].text).toContain('本账号');
   expect(JSON.stringify(archive)).not.toContain('不能进入其他账号备份');
  }finally{await repo.close();}
 });
});
