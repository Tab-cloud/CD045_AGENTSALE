import type { Metadata } from 'next';
import '@agentsale/ui/tokens.css';
import './admin.css';
export const metadata:Metadata={title:'AgentSale · 管理控制台',description:'AgentSale 服务、额度、账号与审计控制台。'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
