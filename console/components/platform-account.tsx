'use client';
import {useEffect,useState,type ReactNode,type FormEvent} from 'react';
export type Account={id:string;username:string;role:'admin'|'operator';phone?:string|null;wechatBound?:boolean};
export async function platformRequest(url:string,body?:unknown){const r=await fetch('/api/v1/'+url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});const data=await r.json();if(!r.ok)throw new Error(data.message||'请求未完成');return data;}
type Providers={sms:boolean;wechat:boolean};
type Mode='password'|'phone'|'register'|'wechat-phone'|'wechat-register';
export function PlatformAccount({admin=false,children}:{admin?:boolean;children:(user:Account,logout:()=>void)=>ReactNode}){
  const [user,setUser]=useState<Account|null>(null),[loading,setLoading]=useState(true),[setup,setSetup]=useState(false),[mode,setMode]=useState<Mode>('password'),[providers,setProviders]=useState<Providers>({sms:false,wechat:false}),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[phone,setPhone]=useState('');
  useEffect(()=>{void platformRequest('auth').then(d=>{setUser(d.user);setSetup(d.setupNeeded);setProviders(d.providers||{sms:false,wechat:false});const result=new URLSearchParams(window.location.search).get('wechat');if(result==='complete'&&!d.user)setMode('wechat-phone');else if(result==='error')setError('微信授权未完成，请重试。');}).catch(e=>setError(String(e.message))).finally(()=>setLoading(false));},[]);
  function changeMode(next:Mode){setMode(next);setError('');setNotice('');}
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');setNotice('');const values=new FormData(e.currentTarget);try{
    const username=String(values.get('username')||''),code=String(values.get('code')||''),password=String(values.get('password')||'');
    if(mode==='wechat-phone'&&!setup){const result=await platformRequest('phone',{action:'wechat-complete',phone,code});if(result.registrationRequired){changeMode('wechat-register');return;}setUser(result.user);return;}
    if(mode==='wechat-register'&&!setup){const result=await platformRequest('phone',{action:'wechat-register',username,password});setUser(result.user);return;}
    const action=setup?'setup':mode==='register'&&providers.sms?'register-phone':mode==='register'?'register':mode==='phone'?'login-phone':'login';
    const result=await platformRequest('auth',{action,username,phone,code,password,setupToken:values.get('setupToken')||''});setUser(result.user);setSetup(false);
  }catch(cause){setError(String((cause as Error).message));}finally{setBusy(false);}}
  async function sendCode(){setBusy(true);setError('');setNotice('');try{const purpose=mode==='register'?'register':mode==='wechat-phone'?'wechat':'login';const result=await platformRequest('phone',{action:'send',phone,purpose});setNotice(result.message);}catch(cause){setError(String((cause as Error).message));}finally{setBusy(false);}}
  async function wechat(){setBusy(true);setError('');try{const result=await platformRequest('wechat/start',{purpose:'login'});window.location.assign(result.url);}catch(cause){setError(String((cause as Error).message));setBusy(false);}}
  async function logout(){try{await platformRequest('auth',{action:'logout'});setUser(null);}catch(cause){setError(String((cause as Error).message));}}
  if(loading)return <main className="account-loading">正在连接聆风…</main>;
  if(user&&(!admin||user.role==='admin'))return children(user,()=>void logout());
  const local=typeof window!=='undefined'&&['localhost','127.0.0.1'].includes(window.location.hostname),canRegister=providers.sms||local;
  const smsMode=!setup&&(mode==='phone'||mode==='register'&&providers.sms||mode==='wechat-phone');
  const showUsername=setup||mode==='register'||mode==='wechat-register'||mode==='password';
  const showPassword=setup||mode==='register'||mode==='wechat-register'||mode==='password';
  const title=user?'需要管理员权限':setup?'初始化管理员':mode==='register'?'创建聆风账号':mode==='phone'?'短信验证码登录':mode==='wechat-phone'?'微信登录 · 验证手机号':mode==='wechat-register'?'完成聆风账号注册':'欢迎回来';
  return <main className="account-login"><div className="account-login-intro"><img src="/brand/lingfeng-logo.png" alt="聆风" width={64} height={64}/><span>聆风 · {admin?'管理中心':'会员中心'}</span><h1>让想法，<br/>有能力成为作品。</h1><p>在桌面端与 Agent 协作。<br/>在这里管理账号、订阅与服务权限。</p></div><form className="account-login-form" onSubmit={submit}><h2>{title}</h2>{user?<><p>当前账号没有管理权限。</p><button type="button" onClick={()=>void logout()}>退出当前账号</button></>:<>
    <p>{setup?'由部署负责人使用初始化口令建立首个管理员。':mode==='wechat-phone'?'首次微信登录请验证手机号；已有账号会自动关联。':mode==='wechat-register'?'手机号已验证，请设置用户名和密码。':mode==='register'?'填写用户名并验证手机号，即可创建账号。':'使用同一账号登录 Web 和桌面应用。'}</p>
    {smsMode&&<><label>手机号<input required name="phone" type="tel" inputMode="numeric" autoComplete="tel" pattern="1[3-9][0-9]{9}" value={phone} onChange={event=>setPhone(event.target.value)} placeholder="中国大陆手机号"/></label><label>短信验证码<input required name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="6 位验证码"/></label><button type="button" disabled={busy||!/^1[3-9]\d{9}$/.test(phone)} onClick={()=>void sendCode()}>发送验证码</button></>}
    {showUsername&&<label>{mode==='password'&&!setup?'用户名 / 手机号':'用户名'}<input required name="username" autoComplete="username" minLength={3} maxLength={40} pattern={mode==='password'&&!setup?undefined:'[A-Za-z0-9_-]+'} placeholder={mode==='password'&&!setup?'用户名或手机号':'3–40 位字母、数字、下划线或连字符'}/></label>}
    {showPassword&&<label>密码<input required name="password" type="password" autoComplete={mode==='password'&&!setup?'current-password':'new-password'} minLength={10} maxLength={128} placeholder="10–128 位"/></label>}
    {setup&&<label>初始化口令<input required name="setupToken" type="password" autoComplete="off"/><small>由服务器的 LINGFENG_SETUP_TOKEN 提供。</small></label>}
    <button className="account-primary" disabled={busy}>{busy?'正在处理…':setup?'建立管理员':mode==='register'?'注册账号':mode==='wechat-phone'?'验证并继续':mode==='wechat-register'?'完成注册': '登录'}</button>
    {!setup&&!admin&&<>{mode!=='password'&&<button type="button" className="account-link" onClick={()=>changeMode('password')}>账号密码登录</button>}{mode!=='phone'&&providers.sms&&<button type="button" className="account-link" onClick={()=>changeMode('phone')}>手机号验证码登录</button>}{mode!=='register'&&<button type="button" className="account-link" disabled={!canRegister} onClick={()=>changeMode('register')}>{canRegister?'注册新账号':'手机号注册暂未开放'}</button>}{providers.wechat&&<button type="button" className="account-link" disabled={busy} onClick={()=>void wechat()}>微信登录</button>}</>}
    {notice&&<p role="status">{notice}</p>}
  </>}{error&&<p role="alert" className="account-error">{error}</p>}</form></main>;
}
