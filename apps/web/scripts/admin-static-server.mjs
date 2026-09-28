import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const staticRoot=fileURLToPath(new URL('../admin-console/dist/',import.meta.url));
const services=new Set(['admin','creative-config','auth','membership-admin']);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
const security={'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY'};

function backend(env){
  const url=new URL(env.AGENTSALE_BACKEND_URL||'http://127.0.0.1:3045');
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Invalid local backend');
  return url.origin;
}

function json(message,status){return Response.json({message},{status,headers:{'Cache-Control':'no-store'}});}

export async function forwardAdminRequest(request,env=process.env){
  const url=new URL(request.url);
  const service=/^\/api\/v1\/([^/]+)$/.exec(url.pathname)?.[1];
  if(!service||!services.has(service))return json('管理门户不代理运营接口',404);
  if(!['GET','POST'].includes(request.method))return json('请求方式不支持',405);
  const host=request.headers.get('host')||url.host;
  let expected;
  try{
    if(env.LINGFENG_ADMIN_URL){
      const configured=new URL(env.LINGFENG_ADMIN_URL);
      if(configured.protocol!=='https:'||configured.host!==host)throw new Error('Invalid admin host');
      expected=configured.origin;
    }else{
      const local=new URL(`http://${host}`);
      if(!['127.0.0.1','localhost','[::1]'].includes(local.hostname)||local.username||local.password)throw new Error('Invalid local host');
      expected=local.origin;
    }
  }catch{return json('无效的管理站点地址',403);}
  if(request.headers.get('sec-fetch-site')==='cross-site'||request.method==='POST'&&request.headers.get('origin')!==expected)return json('请从管理页面提交配置',403);
  let body;
  if(request.method==='POST'){
    body=await request.arrayBuffer();
    if(body.byteLength>120000)return json('管理请求内容过大',413);
  }
  const base=backend(env);
  const headers=new Headers({'Origin':env.LINGFENG_PUBLIC_URL||base});
  const contentType=request.headers.get('content-type');
  if(contentType)headers.set('Content-Type',contentType);
  const session=/(?:^|;\s*)lingfeng_session=([A-Za-z0-9_-]{40,100})(?:;|$)/.exec(request.headers.get('cookie')||'');
  if(session)headers.set('Cookie',`lingfeng_session=${session[1]}`);
  try{
    const upstream=await fetch(`${base}/api/v1/${service}`,{method:request.method,headers,body,cache:'no-store',redirect:'manual'});
    const responseHeaders=new Headers({'Cache-Control':'no-store','Content-Type':upstream.headers.get('content-type')||'application/json'});
    for(const cookie of upstream.headers.getSetCookie())responseHeaders.append('Set-Cookie',cookie);
    return new Response(upstream.body,{status:upstream.status,headers:responseHeaders});
  }catch{return json('服务接口尚未启动，管理页面无法连接',502);}
}

export function createAdminStaticServer({port,backendUrl,environment=process.env,root=staticRoot}){
  const env={...environment,AGENTSALE_BACKEND_URL:backendUrl};
  const server=createServer(async(req,res)=>{
    const host=req.headers.host||'';
    let response;
    try{
      const url=new URL(req.url||'/',`http://${host||'127.0.0.1'}`);
      if(url.pathname.startsWith('/api/')){
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>120000){response=json('管理请求内容过大',413);break;}chunks.push(chunk);}
        if(!response)response=await forwardAdminRequest(new Request(url,{method:req.method,headers:req.headers,body:req.method==='POST'?Buffer.concat(chunks):undefined}),env);
      }else if(req.method!=='GET'&&req.method!=='HEAD')response=json('请求方式不支持',405);
      else if(url.pathname==='/config.json'){
        const memberUrl=env.LINGFENG_PUBLIC_URL||backend(env);
        response=new Response(JSON.stringify({memberUrl}),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      }else{
        const pathname=decodeURIComponent(url.pathname);
        const file=path.resolve(root,`.${pathname==='/'?'/index.html':pathname}`);
        const relative=path.relative(root,file);
        if(relative.startsWith('..')||path.isAbsolute(relative))response=json('资源不存在',404);
        else{
          const content=await readFile(file);
          response=new Response(req.method==='HEAD'?null:content,{headers:{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':file.endsWith('index.html')?'no-store':'public, max-age=86400'}});
        }
      }
    }catch(error){response=json(error?.code==='ENOENT'?'资源不存在':'管理页面暂时不可用',error?.code==='ENOENT'?404:500);}
    res.writeHead(response.status,{...security,...Object.fromEntries(response.headers)});
    if(req.method==='HEAD')res.end();else res.end(Buffer.from(await response.arrayBuffer()));
  });
  return {server,listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(port),'127.0.0.1',()=>{server.off('error',reject);resolve();});})};
}
