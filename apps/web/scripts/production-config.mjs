import path from 'node:path';

function origin(raw,name){
  if(!raw)throw new Error(`${name} is required for public deployment`);
  let url;
  try{url=new URL(raw);}catch{throw new Error(`${name} must be an HTTPS origin`);}
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error(`${name} must be an HTTPS origin`);
  return url.origin;
}

export function productionConfig(env,root){
  if(!env.LINGFENG_PUBLIC_URL)return null;
  const publicOrigin=origin(env.LINGFENG_PUBLIC_URL,'LINGFENG_PUBLIC_URL');
  const adminOrigin=origin(env.LINGFENG_ADMIN_URL,'LINGFENG_ADMIN_URL');
  if(publicOrigin===adminOrigin)throw new Error('Public and admin origins must differ');
  const dataDir=env.AGENTSALE_DATA_DIR;
  if(!dataDir||!path.isAbsolute(dataDir))throw new Error('Public deployment requires an absolute AGENTSALE_DATA_DIR');
  const resolved=path.resolve(dataDir),relative=path.relative(root,resolved);
  if(!relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw new Error('Production data must be outside the source checkout');
  if(env.LINGFENG_LEGACY_ADMIN_WORKER==='1')throw new Error('Legacy admin worker cannot run on the public service');
  if(env.LINGFENG_SETUP_TOKEN&&env.LINGFENG_SETUP_TOKEN.length<24)throw new Error('LINGFENG_SETUP_TOKEN must contain at least 24 characters');
  return {publicOrigin,adminOrigin,dataDir:resolved};
}
