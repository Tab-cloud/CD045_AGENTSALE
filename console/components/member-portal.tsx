'use client';

import {useCallback,useEffect,useState} from 'react';
import {ArrowRight,Check,ChevronDown,Monitor,RefreshCw,ShieldCheck} from 'lucide-react';
import {PlatformAccount,platformRequest,type Account} from './platform-account';

const features=['model','search','image','video'] as const;
type Feature=typeof features[number];
type Plan={id:string;name:string;priceCents:number;days:number;limits:Record<Feature,number>};
type Order={id:string;plan:Plan;status:'pending'|'paid'|'closed';createdAt:string;closedAt?:string;channel:'wechat'|'alipay'};
type State={
  subscription:{active:boolean;membership:{plan:Plan;expiresAt:string}|null;usage:{feature:Feature;used:number}[]};
  plans:Plan[];
  channels:{wechat:boolean;alipay:boolean};
  orders:Order[];
};
type Checkout={kind:'qr';qr:string;order:Order;expiresAt:string};
type RedirectCheckout={kind:'redirect';url:string;order:Order;expiresAt:string};

const featureNames:Record<Feature,string>={model:'AI 对话与规划',search:'网页与知识库检索',image:'图片生成',video:'视频生成'};
const money=(cents:number)=>'¥'+(cents/100).toFixed(2);
const dailyLimit=(limit:number)=>limit===-1?'不限额度':limit===0?'未包含':limit+' 次 / 日';
const dailyUsage=(limit:number,used:number)=>limit===-1?used+' 次已用 / 不限额度':limit===0?'未包含':used+' / '+limit;
const date=(value:string)=>new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const channelName=(channel:Order['channel'])=>channel==='wechat'?'微信支付':'支付宝';

function AccountBindings({user}:{user:Account}){
  const [providers,setProviders]=useState({sms:false,wechat:false});
  const [phone,setPhone]=useState(user.phone||'');
  const [code,setCode]=useState('');
  const [boundPhone,setBoundPhone]=useState(user.phone||'');
  const [wechatBound,setWechatBound]=useState(Boolean(user.wechatBound));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  useEffect(()=>{
    void platformRequest('auth').then(value=>setProviders(value.providers||{sms:false,wechat:false})).catch(()=>{});
    if(new URLSearchParams(window.location.search).get('wechat')==='bound'){
      setWechatBound(true);
      setNotice('微信已绑定，现在可以使用微信登录。');
    }
  },[]);
  async function sendCode(){
    setBusy(true);setError('');setNotice('');
    try{await platformRequest('phone',{action:'send',phone,purpose:'bind'});setNotice('验证码已发送，5 分钟内有效。');}
    catch(cause){setError((cause as Error).message);}
    finally{setBusy(false);}
  }
  async function bindPhone(){
    setBusy(true);setError('');setNotice('');
    try{await platformRequest('phone',{action:'bind',phone,code});setBoundPhone(phone);setCode('');setNotice('手机号已绑定。');}
    catch(cause){setError((cause as Error).message);}
    finally{setBusy(false);}
  }
  async function bindWechat(){
    setBusy(true);setError('');
    try{const result=await platformRequest('wechat/start',{purpose:'bind'});window.location.assign(result.url);}
    catch(cause){setError((cause as Error).message);setBusy(false);}
  }

  return <section className="portal-section" id="account">
    <div className="portal-section-heading"><div><span className="portal-eyebrow">ACCOUNT</span><h2>账号与登录方式</h2><p>会员权益与订单始终保留在同一个聆风账号下。</p></div></div>
    <div className="portal-account-grid">
      <div className="portal-account-card"><span className="portal-account-icon">01</span><span className="portal-state-tag" data-active>已设置</span><h3>聆风账号</h3><p>{user.username}</p><small>可使用用户名和密码登录</small></div>
      <div className="portal-account-card"><span className="portal-account-icon">02</span><span className="portal-state-tag" data-active={Boolean(boundPhone)}>{boundPhone?'已绑定':'未绑定'}</span><h3>手机号</h3><p>{boundPhone||'绑定后可使用短信验证码登录'}</p>
        {!boundPhone&&providers.sms&&<div className="portal-bind-form"><label>手机号<input type="tel" inputMode="numeric" autoComplete="tel" value={phone} onChange={event=>setPhone(event.target.value)} placeholder="中国大陆手机号"/></label><div className="portal-code-row"><label>验证码<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event=>setCode(event.target.value)} placeholder="6 位验证码" maxLength={6}/></label><button type="button" disabled={busy||!/^1[3-9]\d{9}$/.test(phone)} onClick={()=>void sendCode()}>发送验证码</button></div><button className="portal-button portal-button-primary" type="button" disabled={busy||!/^\d{6}$/.test(code)} onClick={()=>void bindPhone()}>绑定手机号</button></div>}
        {!boundPhone&&!providers.sms&&<small>手机号绑定暂未开放</small>}
      </div>
      <div className="portal-account-card"><span className="portal-account-icon">03</span><span className="portal-state-tag" data-active={wechatBound}>{wechatBound?'已绑定':'未绑定'}</span><h3>微信登录</h3><p>{wechatBound?'可以直接使用微信登录':'绑定后可快速登录同一账号'}</p>{!wechatBound&&providers.wechat&&<button className="portal-button portal-button-secondary" type="button" disabled={busy} onClick={()=>void bindWechat()}>绑定微信</button>}{!wechatBound&&!providers.wechat&&<small>微信登录暂未开放</small>}</div>
    </div>
    {notice&&<p role="status" className="portal-feedback portal-feedback-success">{notice}</p>}
    {error&&<p role="alert" className="portal-feedback portal-feedback-error">{error}</p>}
  </section>;
}

function Membership({user,logout}:{user:Account;logout:()=>void}){
  const [data,setData]=useState<State|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [paymentNotice,setPaymentNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [checkingOrder,setCheckingOrder]=useState('');
  const [closingOrder,setClosingOrder]=useState('');
  const [showAllOrders,setShowAllOrders]=useState(false);
  const [checkout,setCheckout]=useState<Checkout|null>(null);
  const refresh=useCallback(async()=>{const next=await platformRequest('membership') as State;setData(next);return next;},[]);

  useEffect(()=>{
    void refresh().catch(cause=>setError((cause as Error).message)).finally(()=>setLoading(false));
    const onFocus=()=>{void refresh().catch(()=>{});};
    window.addEventListener('focus',onFocus);
    return()=>window.removeEventListener('focus',onFocus);
  },[refresh]);
  useEffect(()=>{
    const url=new URL(window.location.href);
    if(url.searchParams.get('payment')!=='return')return;
    const orderId=url.searchParams.get('orderId')||'';
    url.searchParams.delete('payment');url.searchParams.delete('orderId');
    window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
    if(!/^[a-f0-9]{32}$/.test(orderId)){setError('支付返回信息无效，请到订单记录查询到账状态。');return;}
    setPaymentNotice('正在核对支付宝订单，请稍候…');
    void platformRequest('membership',{action:'check',orderId}).then(async result=>{
      setPaymentNotice(result.order.status==='paid'?'支付成功，会员权益已开通。':'订单尚未确认付款，请稍后在订单记录中查询到账。');
      await refresh();
    }).catch(cause=>{setPaymentNotice('');setError((cause as Error).message);});
  },[refresh]);
  const paid=Boolean(checkout&&data?.orders.some(order=>order.id===checkout.order.id&&order.status==='paid'));
  useEffect(()=>{
    if(!checkout||paid)return;
    const timer=window.setInterval(()=>{void refresh().catch(()=>{});},5000);
    return()=>window.clearInterval(timer);
  },[checkout,paid,refresh]);

  async function buy(planId:string,channel:Order['channel']){
    setBusy(true);setError('');
    try{
      const device=/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)?'mobile':'pc';
      const result=await platformRequest('membership',{planId,channel,device}) as Checkout|RedirectCheckout;
      if(result.kind==='redirect'){
        const gateway=new URL(result.url);
        if(gateway.protocol!=='https:'||gateway.hostname!=='openapi.alipay.com'||gateway.pathname!=='/gateway.do')throw new Error('支付宝收银台地址无效，请稍后重试。');
        window.location.assign(result.url);
        return;
      }
      setCheckout(result);await refresh();
    }
    catch(cause){setError((cause as Error).message);await refresh().catch(()=>{});}
    finally{setBusy(false);}
  }
  async function checkOrder(orderId:string){
    setCheckingOrder(orderId);setError('');
    try{await platformRequest('membership',{action:'check',orderId});await refresh();}
    catch(cause){setError((cause as Error).message);}
    finally{setCheckingOrder('');}
  }
  async function closeOrder(orderId:string){
    if(!window.confirm('确定关闭这笔未付款订单吗？关闭后请不要再使用已打开的支付页面付款。'))return;
    setClosingOrder(orderId);setError('');setPaymentNotice('');
    try{
      const result=await platformRequest('membership',{action:'close',orderId}) as {order:Order};
      setPaymentNotice(result.order.status==='paid'?'订单已付款，无法关闭，会员权益已开通。':'订单已关闭。');
      if(result.order.status==='closed'&&checkout?.order.id===orderId)setCheckout(null);
      await refresh();
    }catch(cause){setError((cause as Error).message);await refresh().catch(()=>{});}
    finally{setClosingOrder('');}
  }

  const active=Boolean(data?.subscription.active);
  const unavailable=!loading&&!data;
  const currentPlan=active?data?.subscription.membership?.plan:null;
  const used=new Map(data?.subscription.usage.map(item=>[item.feature,item.used])||[]);
  const visibleOrders=showAllOrders?data?.orders:data?.orders.slice(0,3);

  return <div className="portal-shell">
    <header className="portal-header"><div className="portal-header-inner"><a className="portal-brand" href="/"><img src="/brand/lingfeng-logo.png" alt="" width={38} height={38}/><span>聆风<small>会员中心</small></span></a><nav aria-label="会员中心导航"><a href="#overview">会员概览</a><a href="#plans">订阅套餐</a><a href="#orders">订单记录</a><a href="#account">账号设置</a></nav><div className="portal-user"><span title={user.username}>{user.username}</span><button type="button" onClick={logout}>退出</button></div></div></header>
    <main className="portal-main">
      <div className="portal-intro"><div><span className="portal-eyebrow">LINGFENG MEMBERSHIP</span><h1>你的聆风账号</h1><p>在这里管理会员、支付与登录方式。创作和 Agent 工作在桌面端继续。</p></div><div className="portal-desktop-note"><Monitor size={20} aria-hidden="true"/><span>桌面端登录同一账号<br/><strong>即可使用已开通的能力</strong></span></div></div>
      {error&&<p role="alert" className="portal-feedback portal-feedback-error">{error}</p>}
      {paymentNotice&&<p role="status" className="portal-feedback portal-feedback-success">{paymentNotice}</p>}
      <section className="portal-overview" id="overview" aria-labelledby="overview-title">
        <div className="portal-membership-card">
          <div className="portal-card-top"><span className="portal-eyebrow">CURRENT PLAN</span><span className="portal-status-pill" data-active={active}>{loading?'加载中':unavailable?'暂不可用':active?'已开通':'未开通'}</span></div>
          <h2 id="overview-title">{loading?'正在获取会员状态…':unavailable?'暂时无法获取会员状态':active?currentPlan?.name:'开启你的会员服务'}</h2>
          <p>{loading?'请稍候，正在同步账号和订阅信息。':unavailable?'请稍后刷新页面重试。':active?'有效期至 '+date(data!.subscription.membership!.expiresAt):data?.subscription.membership?'会员已到期，选择套餐即可续费。':'选择套餐并完成支付后，即可在桌面端使用对应能力。'}</p>
          {!unavailable&&<a className="portal-inline-link" href="#plans">{active?'查看续费套餐':'查看会员套餐'}<ArrowRight size={16} aria-hidden="true"/></a>}
        </div>
        <div className="portal-usage-card">
          <div className="portal-card-top"><span className="portal-eyebrow">TODAY’S ACCESS</span><ShieldCheck size={20} aria-hidden="true"/></div>
          <h3>今日可用额度</h3>
          {active&&currentPlan?<><small>已用 / 每日总量</small><ul>{features.map(feature=><li key={feature}><span>{featureNames[feature]}</span><strong>{dailyUsage(currentPlan.limits[feature],used.get(feature)||0)}</strong></li>)}</ul></>:<p>{loading?'正在获取权益…':unavailable?'会员额度暂时无法加载。':'开通会员后，套餐额度将在这里显示。'}</p>}
        </div>
      </section>
      <section className="portal-section" id="plans"><div className="portal-section-heading"><div><span className="portal-eyebrow">PLANS & PAYMENT</span><h2>选择适合你的会员套餐</h2><p>按需购买，有效期结束后手动续费，不会自动扣款。</p></div></div><div className="portal-plan-grid">{data?.plans.map(plan=><article className="portal-plan-card" key={plan.id}><div className="portal-plan-top"><span className="portal-plan-label">聆风会员</span>{currentPlan?.id===plan.id&&<span className="portal-plan-current"><Check size={14} aria-hidden="true"/>当前套餐</span>}</div><h3>{plan.name}</h3><div className="portal-plan-price"><strong>{money(plan.priceCents)}</strong><span>/ {plan.days} 天</span></div><div className="portal-plan-divider"/><ul>{features.map(feature=><li key={feature}><span>{featureNames[feature]}</span><strong>{dailyLimit(plan.limits[feature])}</strong></li>)}</ul><div className="portal-pay-actions"><button type="button" className="portal-button portal-button-primary" disabled={busy||!data.channels.wechat} onClick={()=>void buy(plan.id,'wechat')}>微信支付</button><button type="button" className="portal-button portal-button-secondary" disabled={busy||!data.channels.alipay} onClick={()=>void buy(plan.id,'alipay')}>支付宝网页支付</button></div>{data.channels.alipay&&<p className="portal-plan-hint">支付宝将按当前设备跳转至电脑或手机收银台。</p>}{!data.channels.wechat&&!data.channels.alipay&&<p className="portal-plan-hint">支付方式暂未开放，请稍后再试。</p>}</article>)}</div>{data&&!data.plans.length&&<div className="portal-empty">会员套餐正在准备中，请等待管理员发布。</div>}{loading&&<div className="portal-empty">正在加载可订阅的套餐…</div>}<details className="portal-policy"><summary>额度与续费说明 <ChevronDown size={16} aria-hidden="true"/></summary><p>续费会增加有效期，续费后的能力以新购买的套餐为准。每日额度按 UTC 日期重置，标为“不限额度”的服务不限制次数；网页搜索、正文读取与知识库检索均计入检索用量，已提交但失败或结果未确认的调用也可能占用额度。</p></details></section>
      {checkout&&<section className="portal-checkout" aria-live="polite"><div><span className="portal-eyebrow">PAYMENT</span><h2>{paid?'支付成功，会员已开通':'扫码完成支付'}</h2><p>{checkout.order.plan.name} · {money(checkout.order.plan.priceCents)}</p><p>{paid?'回到桌面端刷新账号状态，即可开始使用。':'二维码有效期至 '+new Date(checkout.expiresAt).toLocaleTimeString('zh-CN')+'，付款后将自动更新会员状态。'}</p><small>订单号 {checkout.order.id}</small><button type="button" className="portal-button portal-button-secondary" onClick={()=>setCheckout(null)}>关闭</button></div>{!paid&&<img src={checkout.qr} width={210} height={210} alt={channelName(checkout.order.channel)+'订单支付二维码'}/>}</section>}
      <section className="portal-section" id="orders">
        <div className="portal-section-heading"><div><span className="portal-eyebrow">ORDERS</span><h2>订阅订单</h2><p>未付款订单可以关闭；如关闭前已付款，可查询到账结果。</p></div>{Boolean(data?.orders.length)&&<span className="portal-section-count">共 {data!.orders.length} 笔</span>}</div>
        <div className="portal-order-list">
          {visibleOrders?.map(order=><article className="portal-order-row" key={order.id}>
            <div className="portal-order-main"><h3>{order.plan.name}</h3><p>{date(order.createdAt)} · {channelName(order.channel)}</p><details><summary>查看订单号</summary><code>{order.id}</code></details></div>
            <strong className="portal-order-price">{money(order.plan.priceCents)}</strong>
            <div className="portal-order-side">
              <span className="portal-order-status" data-paid={order.status==='paid'} data-closed={order.status==='closed'}>{order.status==='paid'?'已支付':order.status==='closed'?'已关闭':'待付款 / 待确认'}</span>
              {order.status!=='paid'&&<div className="portal-order-actions">
                <button type="button" className="portal-button portal-button-secondary" disabled={Boolean(checkingOrder||closingOrder)} onClick={()=>void checkOrder(order.id)}>{checkingOrder===order.id?<><RefreshCw size={14} aria-hidden="true"/>查询中</>:'查询到账'}</button>
                {order.status==='pending'&&<button type="button" className="portal-button portal-button-close" disabled={Boolean(checkingOrder||closingOrder)} onClick={()=>void closeOrder(order.id)}>{closingOrder===order.id?'关闭中…':'关闭订单'}</button>}
              </div>}
            </div>
          </article>)}
          {data&&!data.orders.length&&<div className="portal-empty">还没有订阅订单。购买套餐后，订单会显示在这里。</div>}
          {loading&&<div className="portal-empty">正在加载订单…</div>}
        </div>
        {Boolean(data&&data.orders.length>3)&&<button type="button" className="portal-show-more" onClick={()=>setShowAllOrders(value=>!value)}>{showAllOrders?'收起订单':'查看全部 '+data!.orders.length+' 笔订单'}<ChevronDown size={16} aria-hidden="true"/></button>}
      </section>
      <AccountBindings user={user}/>
      <footer className="portal-footer"><span>聆风 · 让想法成为作品</span><span>账号与订阅在 Web 管理，创作在桌面端完成。</span></footer>
    </main>
  </div>;
}

export function MemberPortal(){return <PlatformAccount>{(user,logout)=><Membership user={user} logout={logout}/>}</PlatformAccount>}
