import {randomBytes} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath,pathToFileURL } from 'node:url';
import path from 'node:path';
import { createAdminStaticServer } from './admin-static-server.mjs';
import { dataDirectory } from './local-paths.mjs';
import { productionConfig } from './production-config.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url)),mode=['start','build'].includes(process.argv[2])?process.argv[2]:'dev';
const production=mode==='build'?null:productionConfig(process.env,root);
if(production&&mode==='dev')throw new Error('Public deployment requires a production build and pnpm start');
const operatorPort=process.env.AGENTSALE_PORT||'3045',adminPort=process.env.AGENTSALE_ADMIN_PORT||String(Number(operatorPort)+2);
for(const port of [operatorPort,adminPort])if(!/^\d{4,5}$/.test(port)||Number(port)>65535)throw new Error('Invalid local port');
if(operatorPort===adminPort)throw new Error('Operator and administrator ports must differ');
// Local bootstrap is explicit and one-time; never ship a default administrator password.
if(mode!=='build'&&!process.env.LINGFENG_SETUP_TOKEN&&!process.env.LINGFENG_PUBLIC_URL){
  const file=path.join(root,'.local','platform-setup-token');await mkdir(path.dirname(file),{recursive:true,mode:0o700});
  try{await writeFile(file,randomBytes(32).toString('base64url'),{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
  process.env.LINGFENG_SETUP_TOKEN=(await readFile(file,'utf8')).trim();
  console.log('首次管理员初始化口令保存在 '+file+'（仅本机文件，不显示到日志）');
}
const compatibility=pathToFileURL(path.join(root,'apps/web/scripts/windows-readlink.mjs')).href;
const definition={directory:path.join(root,'apps/web/console'),port:operatorPort,environment:{AGENTSALE_LOCAL_DEMO:production?'0':'1',AGENTSALE_DATA_DIR:production?.dataDir||dataDirectory(root)}};
function launch(){const require=createRequire(path.join(definition.directory,'package.json')),args=[require.resolve('next/dist/bin/next'),mode,...(mode==='build'?[]:['--hostname','127.0.0.1','--port',definition.port]),...(mode!=='start'?['--webpack']:[])];return spawn(process.execPath,args,{cwd:definition.directory,stdio:'inherit',windowsHide:true,env:{...process.env,...definition.environment,NODE_OPTIONS:`${process.env.NODE_OPTIONS||''} --import=${compatibility}`.trim(),NEXT_TELEMETRY_DISABLED:'1'}});}
function runAdminBuild(){const require=createRequire(path.join(root,'apps/web/admin-console/package.json'));const viteEntry=require.resolve('vite');return spawn(process.execPath,[path.resolve(path.dirname(viteEntry),'../../bin/vite.js'),'build'],{cwd:path.join(root,'apps/web/admin-console'),stdio:'inherit',windowsHide:true,env:process.env});}
function completed(child){return new Promise(resolve=>child.on('exit',code=>resolve(Number(code)||0)));}
if(mode==='build'){
  for(const startBuild of [launch,runAdminBuild]){const code=await completed(startBuild());if(code!==0)process.exit(code);}
}else{
  if(mode==='dev'){const code=await completed(runAdminBuild());if(code!==0)process.exit(code);}
  const admin=createAdminStaticServer({port:adminPort,backendUrl:`http://127.0.0.1:${operatorPort}`});
  await admin.listen();
  console.log(`管理页面已在 http://127.0.0.1:${adminPort} 启动`);
  const child=launch();let closing=false;
  function stop(signal='SIGTERM'){if(closing)return;closing=true;admin.server.close();if(child.exitCode===null)child.kill(signal);}
  process.on('SIGINT',()=>stop('SIGINT'));process.on('SIGTERM',()=>stop());
  child.on('exit',code=>{if(!closing){stop();process.exitCode=Number(code)||0;}});
}
