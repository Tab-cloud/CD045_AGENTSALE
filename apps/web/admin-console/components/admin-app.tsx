'use client';
import {useEffect,useState} from 'react';
import {AdminPanel} from './admin-panel';
import {BillingSettings} from './billing-settings';
import {PlatformAccount} from '../../console/components/platform-account';

const sections = [
  {id:'membership',label:'会员与支付',number:'01'},
  {id:'services',label:'模型与搜索',number:'02'},
  {id:'creative',label:'图片与视频',number:'03'},
  {id:'channels',label:'店铺账号',number:'04'},
] as const;

export function AdminApp({operatorUrl}:{operatorUrl:string}){
  const [dark,setDark]=useState(false);
  const [activeSection,setActiveSection]=useState(() => window.location.hash.slice(1)||'membership');

  useEffect(()=>{
    const updateHash=()=>setActiveSection(window.location.hash.slice(1)||'membership');
    const updateScroll=()=>{
      const visible=sections.map(({id})=>({id,top:document.getElementById(id)?.getBoundingClientRect().top??Infinity})).filter(section=>section.top<=150).sort((a,b)=>b.top-a.top)[0];
      if(visible)setActiveSection(visible.id);
    };
    window.addEventListener('hashchange',updateHash);
    window.addEventListener('scroll',updateScroll,{passive:true});
    return ()=>{window.removeEventListener('hashchange',updateHash);window.removeEventListener('scroll',updateScroll);};
  },[]);

  function toggle(){
    const next=!dark;
    setDark(next);
    document.body.classList.toggle('dark',next);
  }

  return <PlatformAccount admin>{(user,logout)=><div className="admin-shell">
    <aside className="admin-sidebar">
      <a className="admin-brand" href="#top" aria-label="聆风管理控制台首页"><img src="/brand/lingfeng-logo.png" alt="" width={38} height={38}/><span>聆风<small>管理控制台</small></span></a>
      <div className="admin-nav-caption">工作区</div>
      <nav aria-label="管理导航">{sections.map(section=><a key={section.id} href={'#'+section.id} aria-current={activeSection===section.id?'location':undefined} onClick={()=>setActiveSection(section.id)}><span className="admin-nav-number">{section.number}</span>{section.label}<span className="admin-nav-arrow" aria-hidden="true">↗</span></a>)}</nav>
      <div className="admin-boundary"><span className="admin-boundary-dot"/>仅管理员可修改平台配置。创作任务在桌面端完成。</div>
    </aside>
    <div className="admin-content" id="top">
      <header className="admin-topbar"><div className="admin-breadcrumb"><span>工作区</span><span aria-hidden="true">/</span><strong>平台设置</strong></div><div className="admin-top-actions"><span className="admin-user" title="当前账号"><span aria-hidden="true">{user.username.slice(0,1).toUpperCase()}</span>{user.username}</span><button type="button" className="admin-header-button" onClick={toggle} aria-label={dark?'切换浅色外观':'切换深色外观'}>{dark?'浅色外观':'深色外观'}</button><button type="button" className="admin-header-button" onClick={logout}>退出登录</button></div></header>
      <main>
        <div className="page-heading"><div><span className="portal-label">LINGFENG · PLATFORM</span><h1>平台服务与会员管理</h1><p>管理会员权益、支付渠道与 AI 服务连接。所有配置由平台统一提供。</p></div><a className="btn secondary" href={operatorUrl}>打开会员中心 <span aria-hidden="true">↗</span></a></div>
        <BillingSettings/>
        <AdminPanel/>
        <footer>聆风管理控制台 <span>配置修改保留审计记录</span></footer>
      </main>
    </div>
  </div>}</PlatformAccount>;
}
