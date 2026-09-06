'use client';
import {useState} from 'react';
import {AdminPanel} from './admin-panel';

const operatorUrl=()=>typeof window==='undefined'?'#':`${window.location.protocol}//${window.location.hostname}:${Math.max(1,Number(window.location.port||'80')-2)}`;
export function AdminApp(){
  const [dark,setDark]=useState(false);
  function toggle(){const next=!dark;setDark(next);document.body.classList.toggle('dark',next);}
  return <div className="admin-shell"><aside><div className="admin-brand">AgentSale Control</div><div className="admin-workspace">本机系统配置</div><nav aria-label="管理导航"><a aria-current="page" href="#services">服务与权限</a></nav><div className="admin-boundary">当前为本机直接访问，账户体系后续接入。</div></aside><div><header><span>管理控制台</span><div><span>本机配置模式</span><button className="text-button" onClick={toggle}>{dark?'浅色':'深色'}</button></div></header><main id="services"><div className="page-heading"><div><span className="portal-label">LOCAL CONTROL PLANE</span><h1>服务与运行额度</h1><p>配置模型、密钥、渠道和自动执行边界。</p></div><a className="btn" href={operatorUrl()}>运营入口</a></div><AdminPanel/><footer>AgentSale · 本机管理门户 · 配置修改保留审计记录</footer></main></div></div>;
}
