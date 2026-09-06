import { mkdir,readFile,writeFile,rename } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes,randomUUID,createCipheriv,createDecipheriv } from 'node:crypto';
import { defaults,settingsSchema,FlowError,type SecretSettings,type PublicSettings } from './types';

export function safeSettings(s:SecretSettings):PublicSettings{const {apiKey,searchKey,minimaxKey,...rest}=s;return {...rest,hasApiKey:!!apiKey,hasSearchKey:!!searchKey,hasMinimaxKey:!!minimaxKey};}
async function protect(value:string,decrypt=false):Promise<string>{
  const script=`Add-Type -AssemblyName System.Security; $data=[Console]::In.ReadToEnd(); ${decrypt?"$bytes=[System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($data),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Text.Encoding]::UTF8.GetString($bytes))":"$bytes=[System.Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($data),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($bytes))"}`;
  return new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',c=>output+=c);child.stderr.resume();const timer=setTimeout(()=>child.kill(),15000);child.on('error',()=>reject(new FlowError('VAULT_UNAVAILABLE','系统凭据保护不可用')));child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(output.trim());else reject(new FlowError('VAULT_UNAVAILABLE','无法读取当前系统账号保护的服务配置'));});child.stdin.end(value);});
}
export function createVault(directory:string){
  const file=path.join(directory,'providers.sealed');let cache:SecretSettings|undefined;let writes:Promise<unknown>=Promise.resolve();
  function exclusive<T>(operation:()=>Promise<T>):Promise<T>{const result=writes.then(operation);writes=result.catch(()=>undefined);return result;}
  async function crypt(value:string,decrypt=false){
    if(process.platform==='win32')return protect(value,decrypt);
    const keyPath=path.join(directory,'vault.key');let key:Buffer;
    try{key=await readFile(keyPath);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;key=randomBytes(32);await writeFile(keyPath,key,{mode:0o600,flag:'wx'});}
    if(decrypt){const b=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));cipher.setAuthTag(b.subarray(12,28));return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString();}
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([cipher.update(value),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');
  }
  async function get(){if(cache)return {...cache};await mkdir(directory,{recursive:true,mode:0o700});try{const stored=JSON.parse(await crypt(await readFile(file,'utf8'),true));cache={...defaults,minimaxKey:'',...stored};return {...cache!};}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw new FlowError('VAULT_UNAVAILABLE','服务配置无法解密，请使用原系统账号运行');return {...defaults,apiKey:'',searchKey:'',minimaxKey:'',verifiedAt:null,revision:'unconfigured'};}}
  async function save(raw:unknown,apiKey?:string,searchKey?:string,minimaxKey?:string){return exclusive(async()=>{const parsed=settingsSchema.safeParse(raw);if(!parsed.success)throw new FlowError('CONFIG_INVALID','服务配置不完整或额度超出范围');const old=await get(),changedEndpoint=old.baseUrl!==parsed.data.baseUrl||old.localModel!==parsed.data.localModel;const s:SecretSettings={...parsed.data,apiKey:apiKey===undefined?(changedEndpoint?'':old.apiKey):apiKey,searchKey:searchKey===undefined?old.searchKey:searchKey,minimaxKey:minimaxKey===undefined?(old.minimax.baseUrl!==parsed.data.minimax.baseUrl?'':old.minimaxKey):minimaxKey,verifiedAt:null,revision:randomUUID()};await persist(s);return safeSettings(s);});}
  async function persist(s:SecretSettings){await mkdir(directory,{recursive:true,mode:0o700});const temporary=file+'.'+randomUUID();await writeFile(temporary,await crypt(JSON.stringify(s)),{mode:0o600});await rename(temporary,file);cache=s;}
  async function verified(revision:string){return exclusive(async()=>{const s=await get();if(s.revision!==revision)throw new FlowError('CONFIG_CHANGED','配置已变化，请重新验证');await persist({...s,verifiedAt:new Date().toISOString()});});}
  return {get,save,verified};
}
