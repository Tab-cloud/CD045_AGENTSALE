import {it,expect} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,createCipheriv} from 'node:crypto';
import {createVault,safeSettings} from '../packages/automation/src/vault';
import {defaults,minimaxVideoAllowed} from '../packages/automation/src/types';

it('stores only model providers and migrates previous sealed settings once',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'lingfeng-model-vault-'));
 try{
  const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const {enabled:_,planType:__,textModel:___,...oldAudio}=defaults.minimax;
  const {routing:____,independentAudioEnabled:_____,...oldDefaults}=defaults;
  const old={...oldDefaults,model:'fixture-model',minimax:{...oldAudio,speechLimitCents:10},connectors:{temu:{enabled:true}},connectorSecrets:{temuAccessToken:'old-commerce-secret'},searchKey:'old-search-secret',apiKey:'text-secret',minimaxKey:'audio-secret',revision:'old-revision'};
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(old)),cipher.final()]);
  await writeFile(path.join(root,'vault.key'),key);
  await writeFile(path.join(root,'providers.sealed'),Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64'));
  const vault=createVault(root),saved=await vault.get();
  expect(saved.minimax.enabled).toBe(true);
  expect(saved.minimax.planType).toBe('unspecified');
  expect(saved).not.toHaveProperty('connectors');expect(saved).not.toHaveProperty('searchKey');
  expect(saved.apiKey).toBe('text-secret');expect(saved.minimaxKey).toBe('audio-secret');
  expect(JSON.stringify(safeSettings(saved))).not.toContain('text-secret');
  expect(JSON.stringify(safeSettings(saved))).not.toContain('audio-secret');
  const sealed=await readFile(path.join(root,'providers.sealed'),'utf8');
  expect(sealed).not.toContain('old-commerce-secret');
  const updated=await vault.save({...defaults,model:'new-model',independentAudioEnabled:true},undefined,undefined,undefined,saved.revision);
  expect(updated).toMatchObject({model:'new-model',hasApiKey:true,hasMinimaxKey:true});
  await expect(vault.save({...defaults,model:'wrong'},undefined,undefined,undefined,saved.revision)).rejects.toMatchObject({code:'CONFIG_CHANGED'});
 }finally{await rm(root,{recursive:true,force:true});}
});

it('stores a single MiniMax credential for the aggregate model profile without returning it to admins',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'lingfeng-aggregate-vault-'));
 try{
  const vault=createVault(root),initial=await vault.get();
  const settings={...defaults,baseUrl:'https://api.minimax.io/v1',model:'MiniMax-M3',protocol:'minimax' as const,minimax:{...defaults.minimax,baseUrl:'https://api.minimax.io/v1' as const,enabled:true,aggregate:true}};
  const saved=await vault.save(settings,undefined,undefined,'aggregate-secret',initial.revision);
  expect(saved.hasAggregateKey).toBe(true);
  expect(JSON.stringify(saved)).not.toContain('aggregate-secret');
  const reopened=await createVault(root).get();
  expect(reopened.aggregateKey).toBe('aggregate-secret');
  expect(reopened.minimax.voices).toEqual(defaults.minimax.voices);
  expect(reopened.minimax.aggregate).toBe(true);
  const withVideo=(planType:typeof defaults.minimax.planType,videoModel:typeof defaults.minimax.videoModel)=>({...settings,minimax:{...settings.minimax,planType,videoModel,videoEnabled:true}});
  expect(minimaxVideoAllowed('plus','MiniMax-Hailuo-2.3')).toBe(false);
  await expect(vault.save(withVideo('plus','MiniMax-Hailuo-2.3'),undefined,undefined,undefined,reopened.revision)).rejects.toMatchObject({code:'CONFIG_INVALID'});
  await expect(vault.save(withVideo('max','MiniMax-H3'),undefined,undefined,undefined,reopened.revision)).rejects.toMatchObject({code:'CONFIG_INVALID'});
  const max=await vault.save(withVideo('max','MiniMax-Hailuo-2.3'),undefined,undefined,undefined,reopened.revision);
  expect(max.minimax.videoEnabled).toBe(true);
  expect(minimaxVideoAllowed('payg','MiniMax-H3')).toBe(true);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('saves and reloads the complete discovered voice list beyond the former 100-voice limit',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'lingfeng-voices-vault-'));
 try{
  const vault=createVault(root),initial=await vault.get();
  const voices=Array.from({length:150},(_,index)=>({id:`official-${index}`,name:`音色 ${index}`}));
  const saved=await vault.save({...defaults,minimax:{...defaults.minimax,voices}},undefined,undefined,undefined,initial.revision);
  expect(saved.minimax.voices).toEqual(voices);
  expect((await createVault(root).get()).minimax.voices).toEqual(voices);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('keeps ordinary and aggregate connections separate while validating priority lists',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'lingfeng-routing-vault-'));
 try{
  const vault=createVault(root),initial=await vault.get();
  const settings={...defaults,model:'ordinary-model',routing:{...defaults.routing,'text.generate':['minimax','standard'] as ['minimax','standard']},minimax:{...defaults.minimax,aggregate:true}};
  const saved=await vault.save(settings,'ordinary-key',undefined,'aggregate-key',initial.revision);
  expect(saved).toMatchObject({hasApiKey:true,hasAggregateKey:true,routing:{'text.generate':['minimax','standard']}});
  const reopened=await createVault(root).get();expect(reopened.apiKey).toBe('ordinary-key');expect(reopened.aggregateKey).toBe('aggregate-key');
  await expect(vault.save({...settings,routing:{...settings.routing,'text.generate':['minimax','minimax']}},undefined,undefined,undefined,saved.revision)).rejects.toMatchObject({code:'CONFIG_INVALID'});
  const moved=await vault.save({...settings,routing:{...settings.routing,'text.generate':['standard','minimax']}},undefined,undefined,undefined,saved.revision);
  expect(moved).toMatchObject({hasApiKey:true,hasAggregateKey:true,routing:{'text.generate':['standard','minimax']}});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('moves an existing aggregate key to its own slot without dropping the configured model',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'lingfeng-aggregate-migration-'));
 try{
  const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const old={baseUrl:'https://api.minimax.io/v1',model:'MiniMax-M3',localModel:false,format:'prompt_json',protocol:'minimax',minimax:{...defaults.minimax,baseUrl:'https://api.minimax.io/v1',aggregate:true},apiKey:'existing-aggregate-secret',minimaxKey:'',revision:'old-aggregate'};
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(old)),cipher.final()]);
  await writeFile(path.join(root,'vault.key'),key);
  await writeFile(path.join(root,'providers.sealed'),Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64'));
  const migrated=await createVault(root).get();
  expect(migrated.aggregateKey).toBe('existing-aggregate-secret');expect(migrated.apiKey).toBe('');
  expect(migrated.minimax.textModel).toBe('MiniMax-M3');expect(migrated.model).toBe('');
  expect(migrated.routing['text.generate'][0]).toBe('minimax');
  expect(JSON.stringify(safeSettings(migrated))).not.toContain('existing-aggregate-secret');
 }finally{await rm(root,{recursive:true,force:true});}
});
