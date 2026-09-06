import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { FlowError, type Source } from './types';

export function isPublicAddress(ip:string):boolean {
  if(isIP(ip)===6)return /^[23][0-9a-f]{3}:/i.test(ip)&&!/^2001:(db8|0:|10:|20:)/i.test(ip)&&!/^2002:/i.test(ip);
  if(isIP(ip)!==4)return false;
  const [a,b,c]=ip.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2))||(a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113));
}
export function validUrl(raw:string,local=false){
  let url:URL;try{url=new URL(raw);}catch{throw new FlowError('URL_INVALID','链接格式无效');}
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.username||url.password||!['https:','http:'].includes(url.protocol)||url.hash||(!local&&url.port&&!['80','443'].includes(url.port))||(local&&!loopback))throw new FlowError('URL_REJECTED','链接不在允许的网络范围');
  if(local)return url;
  if(loopback||url.hostname.endsWith('.local')||url.hostname.endsWith('.internal')||url.hostname==='metadata.google.internal')throw new FlowError('URL_REJECTED','禁止访问本机、内网或云元数据地址');
  const ip=url.hostname.replace(/^\[|\]$/g,'');if(isIP(ip)&&!isPublicAddress(ip))throw new FlowError('URL_REJECTED','禁止访问非公网地址');
  return url;
}
const tunMapped=(address:string)=>/^198\.(18|19)\./.test(address);
export function providerAddressAllowed(url:URL,address:string,trustedMiniMax=false,trustedDnsResolver=false){
  // TUN proxies map official service DNS names into RFC 2544 space. Keep TLS
  // hostname verification and permit this range only for these fixed vendors.
  const official=['api.minimaxi.com','api.minimax.cn','api.minimax.io','filecdn.minimax.chat','public-cdn-video-data-algeng.oss-cn-wulanchabu.aliyuncs.com'].includes(url.hostname);
  const resolver=url.hostname==='cloudflare-dns.com';
  return isPublicAddress(address)||((trustedMiniMax&&official||trustedDnsResolver&&resolver)&&url.protocol==='https:'&&(!url.port||url.port==='443')&&tunMapped(address));
}

const publicDnsCache=new Map<string,{allowed:boolean;expires:number}>();
async function publiclyResolvable(hostname:string){
  const cached=publicDnsCache.get(hostname);if(cached&&cached.expires>Date.now())return cached.allowed;
  let allowed=false;
  try{
    const endpoint='https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(hostname)+'&type=A',response=await requestBytes(endpoint,{headers:{Accept:'application/dns-json'},trustedDnsResolver:true,timeout:5000,maxBytes:64_000});
    const document=response.status===200?JSON.parse(response.body.toString()):null,addresses=(document?.Answer||[]).filter((answer:any)=>answer.type===1||answer.type===28).map((answer:any)=>String(answer.data));
    allowed=addresses.length>0&&addresses.every((address:string)=>isPublicAddress(address));
  }catch{}
  publicDnsCache.set(hostname,{allowed,expires:Date.now()+300_000});return allowed;
}

export async function requestBytes(raw:string,options:{method?:string;headers?:Record<string,string>;body?:string|Buffer;local?:boolean;trustedMiniMax?:boolean;trustedDnsResolver?:boolean;timeout?:number;maxBytes?:number;redirects?:number;allowedDomains?:string[]}={}):Promise<{status:number;headers:http.IncomingHttpHeaders;body:Buffer;url:string}>{
  const url=validUrl(raw,options.local),hostname=url.hostname.replace(/^\[|\]$/g,'');
  if(options.allowedDomains?.length&&!options.allowedDomains.some(d=>url.hostname===d||url.hostname.endsWith('.'+d)))throw new FlowError('DOMAIN_RESTRICTED','请求域名不在管理员允许范围');
  let timer:ReturnType<typeof setTimeout>|undefined;
  const records=await Promise.race([lookup(hostname,{all:true}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new FlowError('DNS_TIMEOUT','域名解析超时',true)),5000);})]).finally(()=>clearTimeout(timer));
  if(!records.length)throw new FlowError('URL_REJECTED','域名没有可用地址');
  if(!options.local&&records.some(r=>!providerAddressAllowed(url,r.address,options.trustedMiniMax,options.trustedDnsResolver))){
    const mappedHttps=!isIP(hostname)&&url.protocol==='https:'&&(!url.port||url.port==='443')&&records.every(record=>tunMapped(record.address));
    if(!mappedHttps||!await publiclyResolvable(hostname))throw new FlowError('URL_REJECTED','域名解析到非公网地址');
  }
  const selected=records[0];
  return new Promise((resolve,reject)=>{
    const req=(url.protocol==='https:'?https:http).request(url,{
      method:options.method||'GET',agent:false,headers:{'User-Agent':'AgentSale/0.2 (+supplier-research)','Accept-Encoding':'identity',...options.headers},
      // Pin the checked address to prevent a second DNS lookup/rebinding.
      lookup:((_host:unknown,opts:unknown,cb:Function)=>{if((opts as {all?:boolean}).all)cb(null,[selected]);else cb(null,selected.address,selected.family);}) as never
    },res=>{
      const chunks:Buffer[]=[];let size=0;
      res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>(options.maxBytes||2_000_000)){req.destroy(new FlowError('RESPONSE_TOO_LARGE','响应超过允许大小'));return;}chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',async()=>{
        if(res.statusCode&&res.statusCode>=300&&res.statusCode<400&&res.headers.location){
          if(options.method==='POST'||options.headers?.Authorization||options.headers?.['X-Subscription-Token']){reject(new FlowError('REDIRECT_REJECTED','带凭据的请求不跟随重定向'));return;}
          if((options.redirects||0)>=3){reject(new FlowError('REDIRECT_LIMIT','网页重定向过多'));return;}
          try{resolve(await requestBytes(new URL(res.headers.location,url).href,{...options,redirects:(options.redirects||0)+1}));}catch(e){reject(e);}return;
        }
        resolve({status:res.statusCode||0,headers:res.headers,body:Buffer.concat(chunks),url:url.href});
      });
    });
    const deadline=setTimeout(()=>req.destroy(new FlowError('NETWORK_TIMEOUT','请求超时，未确认的调用不会自动重发',true)),options.timeout||20000);
    req.on('close',()=>clearTimeout(deadline));
    req.on('error',e=>reject(e instanceof FlowError?e:new FlowError('NETWORK_ERROR','网络连接失败，请检查服务或稍后重试',true)));
    if(options.body)req.write(options.body);req.end();
  });
}
export function extractSource(html:string,url:string):Source {
  const $=load(html);$('script,style,noscript,svg,iframe,form').remove();
  const title=$('title').text().trim().slice(0,250)||new URL(url).hostname;
  const text=$('body').text().replace(/\s+/g,' ').trim().slice(0,18000);
  if(text.length<80)throw new FlowError('SOURCE_EMPTY','网页缺少可读取正文，可能需要登录或动态加载');
  return {id:createHash('sha256').update(url).digest('hex').slice(0,16),url,title,text,hash:createHash('sha256').update(html).digest('hex'),fetchedAt:new Date().toISOString(),status:'fetched'};
}
export function robotsAllows(text:string,path:string){
  let active=false;const rules:{prefix:string;allow:boolean}[]=[];
  for(const raw of text.split(/\r?\n/)){const line=raw.split('#')[0].trim(),idx=line.indexOf(':');if(idx<0)continue;const key=line.slice(0,idx).trim().toLowerCase(),value=line.slice(idx+1).trim();
    if(key==='user-agent')active=value==='*'||value.toLowerCase().startsWith('agentsale');
    else if(active&&['allow','disallow'].includes(key)&&value){const prefix=value.split('*')[0].replace(/\$$/,'');if(path.startsWith(prefix))rules.push({prefix,allow:key==='allow'});}
  }
  return rules.sort((a,b)=>b.prefix.length-a.prefix.length||Number(b.allow)-Number(a.allow))[0]?.allow??true;
}
export async function fetchSource(raw:string,allowedDomains:string[]=[]){
  const url=validUrl(raw);if(allowedDomains.length&&!allowedDomains.some(d=>url.hostname===d||url.hostname.endsWith('.'+d)))throw new FlowError('DOMAIN_RESTRICTED','网页不在管理员允许的来源域名中');
  const robots=await requestBytes(new URL('/robots.txt',url).href,{maxBytes:256000,allowedDomains});
  if(robots.status===200&&!robotsAllows(robots.body.toString(),url.pathname))throw new FlowError('ROBOTS_DENIED','该来源不允许此自动采集路径');
  if(robots.status!==200&&robots.status!==404&&robots.status!==410)throw new FlowError('ROBOTS_UNAVAILABLE','无法确认来源自动访问规则');
  const response=await requestBytes(url.href,{allowedDomains});
  if(response.status!==200)throw new FlowError('SOURCE_HTTP','网页返回 '+response.status+'，未绕过登录或访问限制');
  const finalUrl=new URL(response.url);if(allowedDomains.length&&!allowedDomains.some(d=>finalUrl.hostname===d||finalUrl.hostname.endsWith('.'+d)))throw new FlowError('DOMAIN_RESTRICTED','重定向后的域名不在允许范围');
  if(!String(response.headers['content-type']).includes('text/html'))throw new FlowError('SOURCE_TYPE','当前采集支持 HTML 商品和供货说明页面');
  return extractSource(response.body.toString('utf8'),response.url);
}
