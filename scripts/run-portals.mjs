import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath,pathToFileURL } from 'node:url';
import path from 'node:path';
import { dataDirectory } from './local-paths.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),mode=['start','build'].includes(process.argv[2])?process.argv[2]:'dev';
const operatorPort=process.env.AGENTSALE_PORT||'3045',adminPort=process.env.AGENTSALE_ADMIN_PORT||String(Number(operatorPort)+2);
for(const port of [operatorPort,adminPort])if(!/^\d{4,5}$/.test(port)||Number(port)>65535)throw new Error('Invalid local port');
if(operatorPort===adminPort)throw new Error('Operator and administrator ports must differ');
const compatibility=pathToFileURL(path.join(root,'scripts/windows-readlink.mjs')).href;
const definitions=[
  {name:'operator',directory:path.join(root,'apps/console'),port:operatorPort,environment:{AGENTSALE_LOCAL_DEMO:'1',AGENTSALE_DATA_DIR:dataDirectory(root)}},
  {name:'administrator',directory:path.join(root,'apps/admin-console'),port:adminPort,environment:{AGENTSALE_BACKEND_URL:`http://127.0.0.1:${operatorPort}`}}
];
function launch(definition){const require=createRequire(path.join(definition.directory,'package.json')),args=[require.resolve('next/dist/bin/next'),mode,...(mode==='build'?[]:['--hostname','127.0.0.1','--port',definition.port]),...(mode!=='start'?['--webpack']:[])];return spawn(process.execPath,args,{cwd:definition.directory,stdio:'inherit',windowsHide:true,env:{...process.env,...definition.environment,NODE_OPTIONS:`${process.env.NODE_OPTIONS||''} --import=${compatibility}`.trim(),NEXT_TELEMETRY_DISABLED:'1'}});}
if(mode==='build'){
  for(const definition of definitions){const child=launch(definition),code=await new Promise(resolve=>child.on('exit',resolve));if(code!==0)process.exit(Number(code)||1);}
}else{
  const children=definitions.map(launch);let closing=false;
  function stop(signal='SIGTERM'){if(closing)return;closing=true;for(const child of children)if(child.exitCode===null)child.kill(signal);}
  process.on('SIGINT',()=>stop('SIGINT'));process.on('SIGTERM',()=>stop());
  for(const child of children)child.on('exit',code=>{if(!closing){stop();process.exitCode=Number(code)||0;}});
}
