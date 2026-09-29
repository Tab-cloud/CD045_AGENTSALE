import './account.css';
import type { Metadata } from 'next';
import '@agentsale/ui/tokens.css';
import './globals.css';
import './automation.css';
import './workbench.css';
import './member-portal.css';
export const metadata: Metadata = { icons: { icon: '/brand/lingfeng-logo.png', apple: '/brand/lingfeng-logo.png' }, title: '聆风 · 会员中心', description: '管理聆风账号、会员订阅与服务权益。' };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="zh-CN"><body>{children}</body></html>; }
