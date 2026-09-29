'use client';
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="fatal"><h1>页面暂时无法打开</h1><p>请重试，已保存的商品资料不会被清空。</p><button className="btn primary" onClick={reset}>重新加载</button></main>; }
