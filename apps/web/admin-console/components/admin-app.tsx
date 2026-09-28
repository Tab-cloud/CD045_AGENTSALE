'use client';
import {useEffect,useState} from 'react';
import {AdminPanel} from './admin-panel';
import {BillingSettings} from './billing-settings';
import {CreativeSettings} from './creative-settings';
import {OverviewDashboard} from './overview-dashboard';
import {MemberUsers} from './member-users';
import {OrderLedger} from './order-ledger';
import {AuthServicesEditor} from './auth-services-editor';
import {PlatformAccount} from '../../console/components/platform-account';

const sections = [
  {id:'overview',label:'首页概览',number:'00',title:'平台概览',description:'查看会员与服务运行情况，并管理平台配置。'},
  {id:'membership',label:'会员与支付',number:'01',title:'会员与支付',description:'管理会员套餐、支付渠道与用户权益。'},
  {id:'users',label:'用户管理',number:'02',title:'用户管理',description:'查看注册用户、账号绑定和会员权限。'},
  {id:'orders',label:'订阅账单',number:'03',title:'订阅账单',description:'查询会员订单、收款状态和交易记录。'},
  {id:'auth-services',label:'登录与短信',number:'04',title:'登录与短信',description:'配置手机号验证码与微信登录服务。'},
  {id:'services',label:'模型与搜索',number:'05',title:'模型与搜索',description:'配置桌面端使用的平台模型和检索服务。'},
  {id:'creative',label:'图片与视频',number:'06',title:'图片与视频',description:'配置桌面端创作任务所使用的服务接口。'},
] as const;
type SectionId = typeof sections[number]['id'];
function currentSection():SectionId{
  if(new URLSearchParams(window.location.search).has('oauth'))return 'services';
  const hash=window.location.hash.slice(1);
  if(hash==='channels')return 'services';
  return sections.find(section=>section.id===hash)?.id||'overview';
}

export function AdminApp({operatorUrl}:{operatorUrl:string}){
  const [dark,setDark]=useState(false);
  const [activeSection,setActiveSection]=useState<SectionId>(currentSection);
  useEffect(()=>{
    const update=()=>{setActiveSection(currentSection());window.scrollTo({top:0});};
    window.addEventListener('hashchange',update);
    return ()=>window.removeEventListener('hashchange',update);
  },[]);
  const active=sections.find(section=>section.id===activeSection)!;

  function toggle(){
    const next=!dark;
    setDark(next);
    document.body.classList.toggle('dark',next);
  }

  return <PlatformAccount admin>{(user,logout)=><div className="admin-shell">
    <aside className="admin-sidebar">
      <a className="admin-brand" href="#overview" aria-label="聆风管理控制台首页"><img src="/brand/lingfeng-logo.png" alt="" width={38} height={38}/><span>聆风<small>管理控制台</small></span></a>
      <div className="admin-nav-caption">工作区</div>
      <nav aria-label="管理导航">{sections.map(section=><a key={section.id} href={'#'+section.id} aria-current={activeSection===section.id?'page':undefined} onClick={()=>setActiveSection(section.id)}><span className="admin-nav-number">{section.number}</span>{section.label}<span className="admin-nav-arrow" aria-hidden="true">↗</span></a>)}</nav>
      <div className="admin-boundary"><span className="admin-boundary-dot"/>仅管理员可修改平台配置。创作任务在桌面端完成。</div>
    </aside>
    <div className="admin-content">
      <header className="admin-topbar"><div className="admin-breadcrumb"><span>工作区</span><span aria-hidden="true">/</span><strong>{active.label}</strong></div><div className="admin-top-actions"><span className="admin-user" title="当前账号"><span aria-hidden="true">{user.username.slice(0,1).toUpperCase()}</span>{user.username}</span><button type="button" className="admin-header-button" onClick={toggle} aria-label={dark?'切换浅色外观':'切换深色外观'}>{dark?'浅色外观':'深色外观'}</button><button type="button" className="admin-header-button" onClick={logout}>退出登录</button></div></header>
      <main>
        <div className="page-heading"><div><span className="portal-label">LINGFENG · PLATFORM</span><h1>{active.title}</h1><p>{active.description}</p></div><a className="btn secondary" href={operatorUrl}>打开会员中心 <span aria-hidden="true">↗</span></a></div>
        {activeSection==='overview'&&<OverviewDashboard/>}
        {activeSection==='membership'&&<BillingSettings/>}
        {activeSection==='users'&&<MemberUsers/>}
        {activeSection==='orders'&&<OrderLedger/>}
        {activeSection==='auth-services'&&<AuthServicesEditor/>}
        {activeSection==='services'&&<AdminPanel/>}
        {activeSection==='creative'&&<CreativeSettings/>}
        <footer>聆风管理控制台 <span>配置修改保留审计记录</span></footer>
      </main>
    </div>
  </div>}</PlatformAccount>;
}
