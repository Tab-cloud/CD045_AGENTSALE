import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto';
import {DomainError} from '@agentsale/domain';
import {defaults,settingsSchema,FlowError,minimaxVideoAllowed,type SecretSettings,type PublicSettings} from './types';

export function safeSettings(s:SecretSettings):PublicSettings{
  const {apiKey,minimaxKey,aggregateKey,...settings}=s;
  return {...settings,hasApiKey:!!apiKey,hasMinimaxKey:!!minimaxKey,hasAggregateKey:!!aggregateKey};
}
async function protect(value:string,decrypt=false):Promise<string>{
  const script=`Add-Type -AssemblyName System.Security; $data=[Console]::In.ReadToEnd(); ${decrypt?"$bytes=[System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($data),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Text.Encoding]::UTF8.GetString($bytes))":"$bytes=[System.Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($data),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($bytes))"}`;
  return new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',c=>output+=c);child.stderr.resume();const timer=setTimeout(()=>child.kill(),15000);child.on('error',()=>reject(new FlowError('VAULT_UNAVAILABLE','系统凭据保护不可用')));child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(output.trim());else reject(new FlowError('VAULT_UNAVAILABLE','无法读取当前系统账号保护的模型配置'));});child.stdin.end(value);});
}
export function createVault(directory:string){
  const file=path.join(directory,'providers.sealed');let cache:SecretSettings|undefined;let writes:Promise<unknown>=Promise.resolve();
  function exclusive<T>(operation:()=>Promise<T>):Promise<T>{const result=writes.then(operation);writes=result.catch(()=>undefined);return result;}
  async function crypt(value:string,decrypt=false){
    if(process.platform==='win32')return protect(value,decrypt);
    const keyPath=path.join(directory,'vault.key');let key:Buffer;
    try{key=await readFile(keyPath);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;key=randomBytes(32);try{await writeFile(keyPath,key,{mode:0o600,flag:'wx'});}catch(writeError){if((writeError as NodeJS.ErrnoException).code!=='EEXIST')throw writeError;key=await readFile(keyPath);}}
    if(key.length!==32)throw new FlowError('VAULT_UNAVAILABLE','模型密钥文件无效');
    if(decrypt){const b=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));cipher.setAuthTag(b.subarray(12,28));return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString();}
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([cipher.update(value),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');
  }
  async function persist(value:SecretSettings){
    await mkdir(directory,{recursive:true,mode:0o700});const temporary=file+'.'+randomUUID();
    await writeFile(temporary,await crypt(JSON.stringify(value)),{mode:0o600});await rename(temporary,file);cache=value;
  }
  async function get():Promise<SecretSettings>{
    if(cache)return {...cache};
    await mkdir(directory,{recursive:true,mode:0o700});
    let raw:string;
    try{raw=await readFile(file,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {...defaults,apiKey:'',minimaxKey:'',aggregateKey:'',verifiedAt:null,revision:'unconfigured'};throw new FlowError('VAULT_UNAVAILABLE','模型配置无法读取');}
    try{
      const stored=JSON.parse(await crypt(raw,true)) as Record<string,any>;
      // One-time data migration: retain provider settings and keys, discard removed Web business config.
      const legacyAggregate=stored.minimax?.aggregate===true&&!('aggregateKey' in stored);
      const parsed=settingsSchema.parse({baseUrl:legacyAggregate?defaults.baseUrl:stored.baseUrl,model:legacyAggregate?'':stored.model,localModel:legacyAggregate?false:stored.localModel,format:legacyAggregate?defaults.format:stored.format,protocol:legacyAggregate?defaults.protocol:stored.protocol||'openai',independentAudioEnabled:stored.independentAudioEnabled??(!stored.minimax?.aggregate&&!!stored.minimax?.enabled),independentAudioBaseUrl:stored.independentAudioBaseUrl||stored.minimax?.baseUrl||defaults.independentAudioBaseUrl,routing:stored.routing||{...defaults.routing,...(stored.minimax?.aggregate?{'text.generate':['minimax','standard'],'image.generate':['minimax','standard'],'video.generate':['minimax','standard'],'audio.speech':['minimax','standard']}: {})},minimax:{baseUrl:stored.minimax?.baseUrl||defaults.minimax.baseUrl,speechModel:stored.minimax?.speechModel||defaults.minimax.speechModel,voices:stored.minimax?.voices||[{id:stored.minimax?.voiceId||defaults.minimax.voices[0].id,name:'默认音色'}],enabled:stored.minimax?.enabled??Number(stored.minimax?.speechLimitCents||0)>0,aggregate:stored.minimax?.aggregate??false,textModel:stored.minimax?.textModel||(legacyAggregate?stored.model:defaults.minimax.textModel),planType:stored.minimax?.planType||'unspecified',imageModel:stored.minimax?.imageModel||defaults.minimax.imageModel,videoModel:stored.minimax?.videoModel||defaults.minimax.videoModel,videoEnabled:stored.minimax?.videoEnabled??false}});
      const value:SecretSettings={...parsed,apiKey:legacyAggregate?'':String(stored.apiKey||''),minimaxKey:String(stored.minimaxKey||''),aggregateKey:legacyAggregate?String(stored.apiKey||''):String(stored.aggregateKey||''),verifiedAt:typeof stored.verifiedAt==='string'?stored.verifiedAt:null,revision:String(stored.revision||randomUUID())};
      if(legacyAggregate||!stored.routing||!('independentAudioEnabled' in stored)||!('independentAudioBaseUrl' in stored)||'connectors' in stored||'connectorSecrets' in stored||'searchKey' in stored||'speechLimitCents' in (stored.minimax||{})||'voiceId' in (stored.minimax||{})||!('planType' in (stored.minimax||{})))await persist(value);
      else cache=value;
      return {...value};
    }catch{throw new FlowError('VAULT_UNAVAILABLE','模型配置无法解密或格式无效，请检查服务端配置');}
  }
  async function save(raw:unknown,apiKey?:string,minimaxKey?:string,aggregateKey?:string,expectedRevision?:string){return exclusive(async()=>{
    const parsed=settingsSchema.safeParse(raw);if(!parsed.success)throw new FlowError('CONFIG_INVALID','模型配置格式无效');
    const old=await get();if(expectedRevision!==old.revision)throw new DomainError('CONFIG_CHANGED','模型配置已被其他管理员修改，请刷新后重试',409);
    const key=apiKey===undefined?(old.baseUrl===parsed.data.baseUrl&&old.localModel===parsed.data.localModel?old.apiKey:''):apiKey.trim();
    const audioKey=minimaxKey===undefined?(old.independentAudioBaseUrl===parsed.data.independentAudioBaseUrl?old.minimaxKey:''):minimaxKey.trim();
    const bundleKey=aggregateKey===undefined?(old.minimax.baseUrl===parsed.data.minimax.baseUrl?old.aggregateKey:''):aggregateKey.trim();
    if([key,audioKey,bundleKey].some(value=>value.length>4000||/[\r\n]/.test(value)))throw new FlowError('CONFIG_INVALID','模型密钥格式无效');
    if(parsed.data.minimax.aggregate){
      if(!bundleKey)throw new FlowError('CONFIG_INVALID','启用 MiniMax 聚合连接前请配置密钥');
    }
    if(parsed.data.independentAudioEnabled&&!audioKey)throw new FlowError('CONFIG_INVALID','启用独立音频模型前请配置密钥');
    if(parsed.data.minimax.videoEnabled){
      const {planType,videoModel,aggregate}=parsed.data.minimax;
      if(!aggregate||!minimaxVideoAllowed(planType,videoModel))throw new FlowError('CONFIG_INVALID','当前 MiniMax 密钥类型或视频模型不支持开放该视频能力');
    }
    const sameConnection=old.baseUrl===parsed.data.baseUrl&&old.model===parsed.data.model&&old.localModel===parsed.data.localModel&&old.format===parsed.data.format&&old.protocol===parsed.data.protocol&&old.independentAudioEnabled===parsed.data.independentAudioEnabled&&old.independentAudioBaseUrl===parsed.data.independentAudioBaseUrl&&JSON.stringify(old.minimax)===JSON.stringify(parsed.data.minimax)&&old.apiKey===key&&old.minimaxKey===audioKey&&old.aggregateKey===bundleKey;
    const next:SecretSettings={...parsed.data,apiKey:key,minimaxKey:audioKey,aggregateKey:bundleKey,verifiedAt:sameConnection?old.verifiedAt:null,revision:randomUUID()};
    await persist(next);return safeSettings(next);
  });}
  async function verified(revision:string){return exclusive(async()=>{const current=await get();if(current.revision!==revision)throw new FlowError('CONFIG_CHANGED','模型配置已变化，请重新验证');await persist({...current,verifiedAt:new Date().toISOString()});});}
  return {get,save,verified,sealText:(value:string)=>crypt(value),unsealText:(value:string)=>crypt(value,true)};
}
