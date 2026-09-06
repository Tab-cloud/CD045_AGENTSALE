import type { Metadata } from 'next';
import '@agentsale/ui/tokens.css';
import './globals.css';
import './automation.css';
import './workbench.css';
export const metadata: Metadata = { title: 'AgentSale · Agent 工作台', description: '通过对话驱动中国工厂产品的海外分销 Agent。' };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="zh-CN"><body>{children}</body></html>; }
