import {it,expect} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,createCipheriv} from 'node:crypto';
import {createVault,safeSettings} from '../packages/automation/src/vault';
import {defaults} from '../packages/automation/src/types';

it('stores only model providers and migrates previous sealed settings once',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'lingfeng-model-vault-'));
 try{
  const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const {enabled:_,...oldAudio}=defaults.minimax;
  const old={...defaults,model:'fixture-model',minimax:{...oldAudio,speechLimitCents:10},connectors:{temu:{enabled:true}},connectorSecrets:{temuAccessToken:'old-commerce-secret'},searchKey:'old-search-secret',apiKey:'text-secret',minimaxKey:'audio-secret',revision:'old-revision'};
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(old)),cipher.final()]);
  await writeFile(path.join(root,'vault.key'),key);
  await writeFile(path.join(root,'providers.sealed'),Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64'));
  const vault=createVault(root),saved=await vault.get();
  expect(saved.minimax.enabled).toBe(true);
  expect(saved).not.toHaveProperty('connectors');expect(saved).not.toHaveProperty('searchKey');
  expect(saved.apiKey).toBe('text-secret');expect(saved.minimaxKey).toBe('audio-secret');
  expect(JSON.stringify(safeSettings(saved))).not.toContain('text-secret');
  expect(JSON.stringify(safeSettings(saved))).not.toContain('audio-secret');
  const sealed=await readFile(path.join(root,'providers.sealed'),'utf8');
  expect(sealed).not.toContain('old-commerce-secret');
  const updated=await vault.save({...defaults,model:'new-model',minimax:{...defaults.minimax,enabled:true}},undefined,undefined,saved.revision);
  expect(updated).toMatchObject({model:'new-model',hasApiKey:true,hasMinimaxKey:true});
  await expect(vault.save({...defaults,model:'wrong'},undefined,undefined,saved.revision)).rejects.toMatchObject({code:'CONFIG_CHANGED'});
 }finally{await rm(root,{recursive:true,force:true});}
});
