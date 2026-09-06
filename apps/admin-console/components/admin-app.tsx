'use client';
import {useState} from 'react';
import {AdminPanel} from './admin-panel';

const operatorUrl='http://127.0.0.1:3045/';
export function AdminApp(){
  const [dark,setDark]=useState(false);
  function toggle(){const next=!dark;setDark(next);document.body.classList.toggle('dark',next);}
  return <div className="admin-shell"><aside><div className="admin-brand">AgentSale Control</div><div className="admin-workspace">高级系统配置</div><nav aria-label="管理导航"><a aria-current="page" href="#services">服务与权限</a></nav><div className="admin-boundary">日常使用请返回 Agent 对话工作台。</div></aside><div><header><span>高级配置</span><div><span>本机配置模式</span><button className="text-button" onClick={toggle}>{dark?'浅色':'深色'}</button></div></header><main id="services"><div className="page-heading"><div><span className="portal-label">ADVANCED SETTINGS</span><h1>连接器与执行边界</h1><p>这里只保留低频、完整的平台连接参数。</p></div><a className="btn primary" href={operatorUrl}>返回 Agent</a></div><AdminPanel/><footer>AgentSale · 高级配置 · 配置修改保留审计记录</footer></main></div></div>;
}
