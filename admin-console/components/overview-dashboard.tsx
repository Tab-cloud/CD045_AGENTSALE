'use client';
import {useEffect,useState} from 'react';
import type {DashboardSummary} from '../../packages/automation/src/membership';

const money=(cents:number)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(cents/100);
const featureNames={model:'文本模型调用',image:'图片生成',video:'视频生成',audio:'音频模型调用'};
type DashboardView=DashboardSummary&{services:{model:string;image:boolean;video:boolean;wechat:boolean;alipay:boolean;creativeAvailable:boolean;paymentAvailable:boolean}};

export function OverviewDashboard(){
  const [summary,setSummary]=useState<DashboardView|null>(null);
  const [error,setError]=useState('');
  const [refreshing,setRefreshing]=useState(false);

  async function refresh(){
    setRefreshing(true);
    try{
      const response=await fetch('/api/v1/dashboard',{cache:'no-store'});
      const body=await response.json();
      if(!response.ok)throw new Error(body.message||'统计数据暂时不可用');
      setSummary(body as DashboardView);
      setError('');
    }catch(cause){setError(cause instanceof Error?cause.message:'统计数据暂时不可用');}
    finally{setRefreshing(false);}
  }

  useEffect(()=>{
    void refresh();
    const timer=window.setInterval(()=>void refresh(),60000);
    return ()=>window.clearInterval(timer);
  },[]);

  const totalUsage=summary?.usageToday.reduce((total,item)=>total+item.count,0)||0;
  const maxOrders=Math.max(1,...(summary?.trend.map(item=>item.paidOrders)||[]));

  return <section id="overview" className="overview-dashboard" aria-labelledby="overview-title">
    <div className="overview-heading"><div><span className="portal-label">OVERVIEW</span><h2 id="overview-title">平台数据</h2><p>基于已保存的账号、支付订单和会员调用记录。</p></div><button type="button" className="btn" onClick={()=>void refresh()} disabled={refreshing}>{refreshing?'更新中…':'刷新数据'}</button></div>
    {error&&<p className="feedback error" role="alert">{error}</p>}
    {!summary?<div className="overview-loading" role="status">{error?'无法读取统计数据，请稍后重试。':'正在读取统计数据…'}</div>:<>
      <div className="overview-metrics">
        <article><span>注册用户</span><strong>{summary.totals.users.toLocaleString('zh-CN')}</strong><small>不含管理员账号</small></article>
        <article><span>有效会员</span><strong>{summary.totals.activeMembers.toLocaleString('zh-CN')}</strong><small>当前有效且账号正常</small></article>
        <article><span>已支付订单</span><strong>{summary.totals.paidOrders.toLocaleString('zh-CN')}</strong><small>{summary.totals.pendingOrders} 笔待支付</small></article>
        <article><span>累计支付金额</span><strong>{money(summary.totals.revenueCents)}</strong><small>未扣除退款与手续费</small></article>
      </div>
      <div className="overview-details">
        <article className="overview-card"><div className="overview-card-heading"><div><h3>近 7 天支付趋势</h3><p>按 UTC 日期统计已支付订单</p></div><span>{summary.trend.reduce((total,item)=>total+item.paidOrders,0)} 笔</span></div>
          {summary.trend.some(item=>item.paidOrders>0)?<div className="overview-chart" role="img" aria-label={'近 7 天每日支付订单：'+summary.trend.map(item=>`${item.day} ${item.paidOrders} 笔`).join('，')}>
            {summary.trend.map(item=><div className="overview-chart-day" key={item.day}><strong>{item.paidOrders||'—'}</strong><div className="overview-chart-track"><span style={{height:`${item.paidOrders?Math.max(8,item.paidOrders/maxOrders*100):0}%`}}/></div><small>{item.day.slice(5)}</small></div>)}
          </div>:<p className="overview-empty">暂无已支付订单；到账核验后会显示交易趋势。</p>}
        </article>
        <article className="overview-card"><div className="overview-card-heading"><div><h3>今日服务调用</h3><p>按 UTC 日期统计已扣减的会员额度</p></div><span>{totalUsage} 次</span></div>
          <div className="overview-usage">{summary.usageToday.map(item=><div className="overview-usage-row" key={item.feature}><div><span>{featureNames[item.feature]}</span><strong>{item.count} 次</strong></div><div className="overview-usage-track"><span style={{width:`${totalUsage?item.count/totalUsage*100:0}%`}}/></div></div>)}</div>
        </article>
      </div>
      <article className="overview-card overview-services"><div className="overview-card-heading"><div><h3>服务状态</h3><p>配置摘要；实际可用性以连接验证和服务商响应为准</p></div></div>
        <div className="overview-service-grid">
          <div><span>文本模型</span><strong>{summary.services.model}</strong><a href="#services">查看配置</a></div>
          <div><span>图片 / 视频</span><strong>{summary.services.creativeAvailable?`${summary.services.image?'图片已启用':'图片未启用'} · ${summary.services.video?'视频已启用':'视频未启用'}`:'状态暂不可用'}</strong><a href="#creative">查看配置</a></div>
          <div><span>微信 / 支付宝</span><strong>{summary.services.paymentAvailable?`${summary.services.wechat?'微信已启用':'微信未启用'} · ${summary.services.alipay?'支付宝已启用':'支付宝未启用'}`:'状态暂不可用'}</strong><a href="#membership">查看配置</a></div>
        </div>
      </article>
      <article className="overview-card overview-orders"><div className="overview-card-heading"><div><h3>最近支付</h3><p>仅显示已核验到账的最近 5 笔订单</p></div><span>累计 {money(summary.totals.revenueCents)}</span></div>
        {summary.recentOrders.length?<div className="table-wrap"><table><thead><tr><th>用户</th><th>套餐</th><th>支付方式</th><th>到账时间</th><th>金额</th></tr></thead><tbody>{summary.recentOrders.map(order=><tr key={order.id}><td>{order.username}</td><td>{order.planName}</td><td>{order.channel==='wechat'?'微信':'支付宝'}</td><td>{new Date(order.paidAt).toLocaleString('zh-CN')}</td><td>{money(order.priceCents)}</td></tr>)}</tbody></table></div>:<p className="overview-empty">暂无已支付订单。</p>}
      </article>
      <p className="overview-updated">更新于 {new Date(summary.generatedAt).toLocaleString('zh-CN')} · 统计使用真实订单与调用记录</p>
    </>}
  </section>;
}
