import type { Metadata } from 'next';
import '@agentsale/ui/tokens.css';
import './globals.css';
import './automation.css';
export const metadata: Metadata = { title: 'AgentSale · 运营工作台', description: '中国工厂产品的海外分销运营工作台。' };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="zh-CN"><body>{children}</body></html>; }
