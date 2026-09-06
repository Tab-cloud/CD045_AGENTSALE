const allowed=new Set(['auth','admin']);
function backend(){const value=process.env.AGENTSALE_BACKEND_URL||'http://127.0.0.1:3045',url=new URL(value);if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/')throw new Error('Invalid local backend');return url.origin;}
async function forward(request:Request,context:{params:Promise<{service:string}>}){
  const {service}=await context.params;if(!allowed.has(service))return Response.json({message:'管理门户不代理运营接口'},{status:404});
  let body:ArrayBuffer|undefined;if(request.method==='POST'){body=await request.arrayBuffer();if(body.byteLength>120000)return Response.json({message:'管理请求内容过大'},{status:413});}
  const base=backend(),headers=new Headers({'Origin':base});const cookie=request.headers.get('cookie'),contentType=request.headers.get('content-type');if(cookie)headers.set('Cookie',cookie);if(contentType)headers.set('Content-Type',contentType);
  try{const upstream=await fetch(`${base}/api/v1/${service}`,{method:request.method,headers,body,cache:'no-store',redirect:'manual'}),resultHeaders=new Headers({'Cache-Control':'no-store','Content-Type':upstream.headers.get('content-type')||'application/json'}),setCookie=upstream.headers.get('set-cookie');if(setCookie)resultHeaders.set('Set-Cookie',setCookie);return new Response(upstream.body,{status:upstream.status,headers:resultHeaders});}
  catch{return Response.json({message:'运营服务尚未启动，管理控制台无法连接身份与配置服务'},{status:502});}
}
export const dynamic='force-dynamic';export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{service:string}>}){return forward(request,context);}
export async function POST(request:Request,context:{params:Promise<{service:string}>}){return forward(request,context);}
