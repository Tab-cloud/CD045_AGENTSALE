'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {PlatformAccount,platformRequest} from './platform-account';

const key='lingfeng.desktop.login';
const valid=(value:string)=>/^[A-Za-z0-9_-]{40,100}$/.test(value);
function clearDesktopLogin(){sessionStorage.removeItem(key);sessionStorage.removeItem(key+'.startedAt');}

export function DesktopLoginReturn(){
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    if(!params.has('wechat'))return;
    const id=sessionStorage.getItem(key)||'',startedAt=Number(sessionStorage.getItem(key+'.startedAt'));
    if(!valid(id)||!Number.isFinite(startedAt)||Date.now()-startedAt>10*60000){clearDesktopLogin();return;}
    const target=new URL('/desktop-connect',window.location.origin);
    target.searchParams.set('request',id);
    target.searchParams.set('wechat',params.get('wechat')||'error');
    window.location.replace(target.href);
  },[]);
  return null;
}

export function DesktopConnect(){
  const [id,setId]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    const value=new URLSearchParams(window.location.search).get('request')||'';
    if(!valid(value)){setError('桌面连接链接无效，请在应用中重新发起。');return;}
    if(sessionStorage.getItem(key)!==value)sessionStorage.setItem(key+'.startedAt',String(Date.now()));
    sessionStorage.setItem(key,value);
    setId(value);
  },[]);
  async function approve(event:FormEvent){
    event.preventDefault();
    setBusy(true);setError('');
    try{
      await platformRequest('desktop-login',{action:'approve',id,code});
      clearDesktopLogin();
      setDone(true);
    }catch(cause){setError(String((cause as Error).message));}
    finally{setBusy(false);}
  }
  if(!id)return <main className="desktop-connect"><h1>连接聆风桌面端</h1><p>{error||'正在准备登录…'}</p></main>;
  return <PlatformAccount>{(user,logout)=><main className="desktop-connect"><div className="desktop-connect-card"><img src="/brand/lingfeng-logo.png" width={48} height={48} alt=""/><h1>连接聆风桌面端</h1>{done?<><p>已允许 <strong>{user.username}</strong> 登录桌面应用。可以返回桌面端继续。</p><a href="/">前往会员中心</a></>:<><p>当前网页账号：<strong>{user.username}</strong></p><p>请核对桌面应用显示的 6 位配对码。确认后，桌面应用将以此账号登录。</p><form onSubmit={event=>void approve(event)}><label htmlFor="desktop-code">桌面配对码</label><input id="desktop-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event=>setCode(event.target.value)} placeholder="输入桌面端显示的 6 位数字"/><button className="account-primary" disabled={busy||!/^\d{6}$/.test(code)}>{busy?'正在连接…':'允许此桌面应用登录'}</button></form><button className="desktop-connect-link" onClick={logout}>切换网页账号</button>{error&&<p role="alert" className="account-error">{error}</p>}</>}</div></main>}</PlatformAccount>;
}
