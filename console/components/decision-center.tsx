'use client';
import { useEffect,useMemo,useState,type FormEvent } from 'react';
import type { MarketDecision,MarketSignalInput,Snapshot } from '@agentsale/contracts';
import { parseMinor } from '@agentsale/domain';
import type { SendCommand } from './forms';

const platformLabels:Record<MarketSignalInput['platform'],string>={tiktok_shop:'TikTok Shop',temu:'Temu',amazon:'Amazon',shopify:'Shopify',other:'其他平台'};
const sourceLabels:Record<MarketSignalInput['sourceType'],string>={authorized_export:'授权店铺 / 数据导出',public_observation:'自动公开网页检索',manual:'其他人工资料'};
const recommendationLabels:Record<MarketDecision['recommendation'],string>={insufficient_data:'数据不足',sample_test:'建议小额测试',investigate:'继续调研',reject:'暂不投入'};
const dimensionLabels={demand:'市场需求',competition:'竞争空间',content:'内容潜力',fulfillment:'履约能力',economics:'经济性'} as const;

function optionalInteger(data:FormData,name:string,max:number){const raw=String(data.get(name)||'').replaceAll(',','').trim();if(!raw)return null;if(!/^\d+$/.test(raw)||Number(raw)>max)throw new Error(`${name} 需要填写有效非负整数`);return Number(raw);}
function optionalDecimal(data:FormData,name:string,max:number,multiplier:number){const raw=String(data.get(name)||'').trim();if(!raw)return null;if(!/^\d{1,7}(\.\d{1,2})?$/.test(raw)||Number(raw)>max)throw new Error(`${name} 数值无效`);return Math.round(Number(raw)*multiplier);}
function score(value:number|null){return value===null?'—':String(value);}
function DecisionCard({decision,productName}:{decision:MarketDecision;productName:string}){
  return <article className="decision-card">
    <div className="decision-head"><div><span className="eyebrow">{platformLabels[decision.platform]} · {decision.country}</span><h2>{productName}</h2><p>{decision.observedAt} · 置信度 {decision.confidencePercent}%</p></div><div className="decision-score"><strong>{score(decision.overallScore)}</strong><span>/ 100</span></div></div>
    <div className={'decision-verdict '+decision.recommendation}>{recommendationLabels[decision.recommendation]}</div>
    <div className="score-list">{Object.entries(decision.dimensions).map(([key,item])=><div className="score-row" key={key}><div><span>{dimensionLabels[key as keyof typeof dimensionLabels]}</span><small>数据覆盖 {item.coveragePercent}%</small></div><div className="score-track" aria-label={`${dimensionLabels[key as keyof typeof dimensionLabels]} ${score(item.score)} 分`}><i style={{width:`${item.score??0}%`}}/></div><b>{score(item.score)}</b></div>)}</div>
    <details className="decision-detail"><summary>查看评分依据</summary>{Object.entries(decision.dimensions).map(([key,item])=><div key={key}><b>{dimensionLabels[key as keyof typeof dimensionLabels]}</b><p>{item.explanation.length?item.explanation.join('；'):'缺少可计算指标'}</p></div>)}</details>
    <div className="decision-next"><b>下一步</b><ul>{decision.nextActions.map(action=><li key={action}>{action}</li>)}</ul></div>
  </article>;
}

export function DecisionCenter({snapshot,send,busy}:{snapshot:Snapshot;send:SendCommand;busy:boolean}){
  const [productId,setProductId]=useState(snapshot.products[0]?.id||''),[formError,setFormError]=useState('');
  useEffect(()=>{if(!snapshot.products.some(p=>p.id===productId))setProductId(snapshot.products[0]?.id||'');},[snapshot.products,productId]);
  const product=snapshot.products.find(p=>p.id===productId),signals=useMemo(()=>snapshot.marketSignals.filter(s=>s.productId===productId),[snapshot.marketSignals,productId]);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setFormError('');if(!product)return;
    const data=new FormData(event.currentTarget);
    try{
      const signal:MarketSignalInput={platform:String(data.get('platform')) as MarketSignalInput['platform'],country:String(data.get('country')),observedAt:String(data.get('observedAt')),sourceType:String(data.get('sourceType')) as MarketSignalInput['sourceType'],sourceRef:String(data.get('sourceRef')),
        unitsSold7d:optionalInteger(data,'近 7 日销量',10_000_000),views7d:optionalInteger(data,'近 7 日浏览量',1_000_000_000),reviewCount:optionalInteger(data,'评价数',100_000_000),
        ratingHundredths:optionalDecimal(data,'评分',5,100),engagementRateBps:optionalDecimal(data,'互动率',100,100),competitorCount:optionalInteger(data,'竞争商品数',1_000_000),
        medianPriceMinor:String(data.get('medianPrice')||'').trim()?parseMinor(String(data.get('medianPrice'))):null,deliveryDays:optionalInteger(data,'交付天数',365),refundRateBps:optionalDecimal(data,'退款率',100,100),notes:String(data.get('notes')||'')};
      const result=await send({type:'market.snapshot.add',productId:product.id,expectedProductVersion:product.version,signal});if(result)event.currentTarget.reset();
    }catch(error){setFormError(error instanceof Error?error.message:'无法保存市场数据');}
  }
  return <div className="decision-center">
    <section className="decision-intro"><div><span className="eyebrow">MARKET DECISION</span><h2>用可核验信息决定是否测试</h2><p>Agent 默认自动检索公开网页中的市场、价格、竞争与履约线索，无需绑定平台账号。店铺授权只用于补充私有销量、曝光和订单数据。</p></div><div className="decision-kpis"><span><b>{snapshot.decisions.length}</b> 个市场组合</span><span><b>{snapshot.marketSignals.length}</b> 期数据快照</span></div></section>
    {snapshot.decisions.length?<div className="decision-grid">{snapshot.decisions.map(item=><DecisionCard key={item.id} decision={item} productName={snapshot.products.find(p=>p.id===item.productId)?.name||'未知商品'}/>)}</div>:<div className="empty decision-empty"><h2>还没有可评分的市场数据</h2><p>启动选品调研后，Agent 会自动搜索并保存公开市场来源。也可以为已有商品补充同一国家、同一平台、同一统计口径的数据。</p></div>}
    <section className="signal-entry"><div className="sectionrow"><div><h2>新增平台数据快照</h2><p className="muted small">空值不会按零分处理，而是降低数据覆盖率和决策置信度。</p></div><span className="status">人工录入</span></div>
      <form onSubmit={submit}>
        <div className="form-grid"><label className="field">关联商品<select value={productId} onChange={e=>setProductId(e.target.value)}>{snapshot.products.map(item=><option value={item.id} key={item.id}>{item.name} · {item.sku}</option>)}</select></label><label className="field">平台<select name="platform" defaultValue="tiktok_shop"><option value="tiktok_shop">TikTok Shop</option><option value="temu">Temu</option><option value="amazon">Amazon</option><option value="shopify">Shopify</option><option value="other">其他平台</option></select></label><label className="field">国家 / 地区<input name="country" required maxLength={80} placeholder="例如：美国"/></label><label className="field">观察日期<input name="observedAt" type="date" required defaultValue={new Date().toISOString().slice(0,10)}/></label><label className="field">来源类型<select name="sourceType" defaultValue="authorized_export">{Object.entries(sourceLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><label className="field">来源说明<input name="sourceRef" required maxLength={500} placeholder="例如：TikTok Shop 后台导出 2026-W36"/></label></div>
        <h3 className="spaced">市场与内容</h3><div className="form-grid metric-grid"><label className="field">近 7 日销量<input name="近 7 日销量" inputMode="numeric" placeholder="未知可留空"/></label><label className="field">近 7 日浏览量<input name="近 7 日浏览量" inputMode="numeric" placeholder="未知可留空"/></label><label className="field">累计评价数<input name="评价数" inputMode="numeric" placeholder="未知可留空"/></label><label className="field">商品评分 · 0–5<input name="评分" inputMode="decimal" placeholder="例如 4.70"/></label><label className="field">内容互动率 · %<input name="互动率" inputMode="decimal" placeholder="例如 3.20"/></label><label className="field">同类竞争商品数<input name="竞争商品数" inputMode="numeric" placeholder="同口径检索结果"/></label></div>
        <h3 className="spaced">价格与履约</h3><div className="form-grid metric-grid"><label className="field">平台价格中位数 · USD<input name="medianPrice" inputMode="decimal" placeholder="例如 32.90"/></label><label className="field">目标国交付天数<input name="交付天数" inputMode="numeric" placeholder="例如 9"/></label><label className="field">退款率 · %<input name="退款率" inputMode="decimal" placeholder="例如 4.00"/></label><label className="field">补充说明<input name="notes" maxLength={2000} placeholder="统计范围、筛选词或数据限制"/></label></div>
        {formError&&<p className="form-error" role="alert">{formError}</p>}<div className="review-actions"><button className="btn primary" disabled={busy||!product}>保存快照并重新评分</button></div>
      </form>
      {signals.length>0&&<div className="signal-history"><h3>当前商品的数据历史</h3><div className="table-wrap"><table><thead><tr><th>日期</th><th>平台 / 国家</th><th>销量</th><th>浏览</th><th>来源</th></tr></thead><tbody>{signals.map(item=><tr key={item.id}><td>{item.observedAt}</td><td>{platformLabels[item.platform]} · {item.country}</td><td>{item.unitsSold7d??'—'}</td><td>{item.views7d??'—'}</td><td>{sourceLabels[item.sourceType]}<small>{item.sourceRef}</small></td></tr>)}</tbody></table></div></div>}
    </section>
  </div>;
}
