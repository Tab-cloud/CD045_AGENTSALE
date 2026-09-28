'use client';
import {useState} from 'react';
import {AdminPanel} from './admin-panel';
import {BillingSettings} from './billing-settings';
import {PlatformAccount} from '../../console/components/platform-account';

export function AdminApp({operatorUrl}:{operatorUrl:string}){
  const [dark,setDark]=useState(false);
  function toggle(){const next=!dark;setDark(next);document.body.classList.toggle('dark',next);}
  return <PlatformAccount admin>{(user,logout)=><div className="admin-shell"><aside><div className="admin-brand"><img src="/brand/lingfeng-logo.png" alt="" width={36} height={36}/>聆风</div><div className="admin-workspace">平台管理中心</div><nav aria-label="管理导航"><a href="#membership">会员与支付</a><a href="#services">模型与搜索</a><a href="#creative">图片与视频</a><a href="#channels">店铺账号</a></nav><div className="admin-boundary">用户在桌面端使用服务。此处仅限平台管理员。</div></aside><div><header><span>高级配置</span><div><span>{user.username}</span><button onClick={logout}>退出登录</button><button className="text-button" onClick={toggle}>{dark?'浅色':'深色'}</button></div></header><main><div className="page-heading"><div><span className="portal-label">ACCOUNT & CONNECTORS</span><h1>平台服务与会员管理</h1><p>统一配置模型、检索、图片、视频与支付服务。用户通过会员订阅解锁对应能力。</p></div><a className="btn primary" href={operatorUrl}>会员中心</a></div><BillingSettings/><AdminPanel/><footer>聆风 · 高级配置 · 配置修改保留审计记录</footer></main></div></div>}</PlatformAccount>;
}
