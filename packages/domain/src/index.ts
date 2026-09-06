import { costsSchema, type Costs, type Evidence, type MarketDecision, type MarketSignal, type Product } from '@agentsale/contracts';

const domainErrorBrand=Symbol.for('agentsale.domain-error');
export class DomainError extends Error {
  readonly [domainErrorBrand]=true;
  constructor(public code: string, message: string, public status = 400) { super(message); }
  static is(error:unknown):error is DomainError{return error instanceof Error&&(error as unknown as Record<symbol,unknown>)[Symbol.for('agentsale.domain-error')]===true;}
}
export function parseMinor(value: string): number {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value.trim())) throw new DomainError('INVALID_AMOUNT', '金额需为非负数字，最多两位小数');
  const [whole, fraction = ''] = value.trim().split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (result > 100_000_000) throw new DomainError('INVALID_AMOUNT', '金额超出本地演练范围');
  return result;
}
export function formatMinor(minor: number, currency = 'USD') { return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(minor / 100); }
export function convertCnyMinor(value: number, cnyPerUsdMillion: number): number {
  const numerator = BigInt(value) * 1_000_000n;
  const denominator = BigInt(cnyPerUsdMillion);
  return Number((numerator + denominator / 2n) / denominator);
}
export function assessCosts(input: Costs) {
  const costs = costsSchema.parse(input);
  const missing = [costs.procurementCnyMinor === null ? '采购报价' : '', costs.shippingMinor === null ? '国际运费' : ''].filter(Boolean);
  const procurementMinor = costs.procurementCnyMinor === null ? null : convertCnyMinor(costs.procurementCnyMinor, costs.cnyPerUsdMillion);
  if (missing.length) return { complete: false as const, missing, procurementMinor, profitMinor: null, marginPercent: null, breakEvenCacMinor: null };
  const fixed = procurementMinor! + costs.shippingMinor! + costs.feeMinor + costs.afterSaleMinor + costs.mediaMinor;
  const profitMinor = costs.revenueMinor - fixed - costs.acquisitionMinor;
  return { complete: true as const, missing, procurementMinor, profitMinor, marginPercent: costs.revenueMinor === 0 ? null : profitMinor / costs.revenueMinor * 100, breakEvenCacMinor: costs.revenueMinor - fixed };
}

const clamp=(value:number,min=0,max=100)=>Math.min(max,Math.max(min,value));
const rounded=(value:number)=>Math.round(clamp(value));
const logScore=(value:number,ceiling:number)=>rounded(Math.log10(value+1)/Math.log10(ceiling+1)*100);
type Factor={weight:number;score:number|null;detail:string};
function dimension(factors:Factor[]){
  const available=factors.filter(f=>f.score!==null),weight=available.reduce((sum,f)=>sum+f.weight,0);
  return {score:weight?rounded(available.reduce((sum,f)=>sum+f.score!*f.weight,0)/weight):null,coveragePercent:rounded(weight*100),explanation:available.map(f=>f.detail)};
}
const change=(current:number|null,previous:number|null)=>current===null||previous===null||previous===0?null:Math.round((current-previous)/previous*1000)/10;
const platformLabel:Record<MarketSignal['platform'],string>={tiktok_shop:'TikTok Shop',temu:'Temu',amazon:'Amazon',shopify:'Shopify',other:'其他平台'};
export function buildMarketDecisions(products:Product[],evidence:Evidence[],signals:MarketSignal[]):MarketDecision[]{
  const groups=new Map<string,MarketSignal[]>();
  for(const signal of signals){const key=[signal.productId,signal.platform,signal.country.toLowerCase()].join(':');groups.set(key,[...(groups.get(key)||[]),signal]);}
  const decisions:MarketDecision[]=[];
  for(const entries of groups.values()){
    entries.sort((a,b)=>b.observedAt.localeCompare(a.observedAt)||b.createdAt.localeCompare(a.createdAt));
    const latest=entries[0],previous=entries[1]||null,product=products.find(p=>p.id===latest.productId);if(!product)continue;
    const unitsTrend=change(latest.unitsSold7d,previous?.unitsSold7d??null),viewsTrend=change(latest.views7d,previous?.views7d??null);
    const demand=dimension([
      {weight:.4,score:latest.unitsSold7d===null?null:logScore(latest.unitsSold7d,300),detail:`近 7 日销量 ${latest.unitsSold7d??'—'}`},
      {weight:.25,score:latest.views7d===null?null:logScore(latest.views7d,1_000_000),detail:`近 7 日浏览 ${latest.views7d??'—'}`},
      {weight:.15,score:latest.reviewCount===null?null:logScore(latest.reviewCount,10_000),detail:`累计评价 ${latest.reviewCount??'—'}`},
      {weight:.1,score:latest.ratingHundredths===null?null:rounded((latest.ratingHundredths-300)/2),detail:`评分 ${latest.ratingHundredths===null?'—':(latest.ratingHundredths/100).toFixed(2)}`},
      {weight:.1,score:unitsTrend===null?null:rounded(50+unitsTrend),detail:`销量较前次 ${unitsTrend!>=0?'+':''}${unitsTrend??'—'}%`}
    ]);
    const targetPrice=product.costs.revenueMinor,priceRatio=latest.medianPriceMinor&&targetPrice?targetPrice/latest.medianPriceMinor:null;
    const priceScore=priceRatio===null?null:priceRatio<=.9?95:priceRatio<=1?85:priceRatio<=1.15?65:priceRatio<=1.35?35:10;
    const competition=dimension([
      {weight:.55,score:latest.competitorCount===null?null:rounded(100-35*Math.log10(latest.competitorCount+1)),detail:`同类竞争商品 ${latest.competitorCount??'—'}`},
      {weight:.45,score:priceScore,detail:`目标售价为平台中位价的 ${priceRatio===null?'—':Math.round(priceRatio*100)+'%'}`}
    ]);
    const content=dimension([
      {weight:.7,score:latest.engagementRateBps===null?null:rounded(latest.engagementRateBps/5),detail:`内容互动率 ${latest.engagementRateBps===null?'—':(latest.engagementRateBps/100).toFixed(2)+'%'}`},
      {weight:.3,score:latest.views7d===null?null:logScore(latest.views7d,1_000_000),detail:`近 7 日浏览 ${latest.views7d??'—'}`}
    ]);
    const confirmed=evidence.filter(e=>e.productId===product.id&&e.confirmed).length;
    const deliveryScore=latest.deliveryDays===null?null:latest.deliveryDays<=5?100:latest.deliveryDays<=10?85:latest.deliveryDays<=15?65:latest.deliveryDays<=25?35:10;
    const refundScore=latest.refundRateBps===null?null:rounded(100-latest.refundRateBps/1.5);
    const fulfillment=dimension([
      {weight:.35,score:deliveryScore,detail:`预计交付 ${latest.deliveryDays??'—'} 天`},
      {weight:.2,score:product.costs.shippingMinor===null?null:100,detail:'国际运费已录入'},
      {weight:.15,score:product.costs.procurementCnyMinor===null?null:100,detail:'采购报价已录入'},
      {weight:.15,score:confirmed?Math.min(100,confirmed*50):null,detail:`人工确认资料 ${confirmed} 项`},
      {weight:.15,score:refundScore,detail:`退款率 ${latest.refundRateBps===null?'—':(latest.refundRateBps/100).toFixed(2)+'%'}`}
    ]);
    const cost=assessCosts(product.costs),margin=cost.complete?cost.marginPercent:null,breakEvenRatio=cost.complete&&targetPrice?cost.breakEvenCacMinor!/targetPrice:null;
    const economics=dimension([
      {weight:.6,score:margin===null?null:rounded(margin*2),detail:`贡献利润率 ${margin===null?'—':margin.toFixed(1)+'%'}`},
      {weight:.2,score:breakEvenRatio===null?null:rounded(breakEvenRatio*125),detail:`获客成本空间 ${breakEvenRatio===null?'—':Math.round(breakEvenRatio*100)+'%'}`},
      {weight:.2,score:priceScore,detail:`目标售价竞争力 ${priceScore===null?'缺数据':priceScore+' 分'}`}
    ]);
    const dimensions={demand,competition,content,fulfillment,economics},weights={demand:.3,competition:.2,content:.15,fulfillment:.2,economics:.15};
    const available=Object.entries(dimensions).filter(([,d])=>d.score!==null) as [keyof typeof dimensions,typeof demand][];
    const availableWeight=available.reduce((sum,[name])=>sum+weights[name],0);
    const overallScore=availableWeight?rounded(available.reduce((sum,[name,d])=>sum+d.score!*weights[name],0)/availableWeight):null;
    const coverage=Object.entries(dimensions).reduce((sum,[name,d])=>sum+weights[name as keyof typeof weights]*d.coveragePercent,0);
    const trust={authorized_export:.95,public_observation:.75,manual:.6}[latest.sourceType];
    const ageDays=Math.max(0,(Date.now()-Date.parse(latest.observedAt+'T00:00:00Z'))/86400000),freshness=ageDays<=30?1:ageDays<=90?.8:.55;
    const confidencePercent=rounded(coverage*trust*freshness);
    const missing:string[]=[];
    if(latest.unitsSold7d===null)missing.push('近 7 日销量');if(latest.views7d===null)missing.push('近 7 日浏览量');
    if(latest.engagementRateBps===null)missing.push('内容互动率');if(latest.competitorCount===null)missing.push('同类竞争商品数');
    if(latest.medianPriceMinor===null)missing.push('平台价格中位数');if(latest.deliveryDays===null)missing.push('目标国交付天数');
    if(latest.refundRateBps===null)missing.push('退款率');if(!cost.complete)missing.push(...cost.missing);
    if(confirmed===0)missing.push('至少一项人工确认的供货资料');if(product.sample)missing.push('真实商品资料');
    let recommendation:MarketDecision['recommendation']='investigate';
    if(confidencePercent<50||demand.score===null||economics.score===null||confirmed===0||product.sample)recommendation='insufficient_data';
    else if(overallScore!==null&&(overallScore<40||economics.score!<25))recommendation='reject';
    else if(overallScore!==null&&overallScore>=72&&demand.score!>=60&&economics.score!>=55&&fulfillment.score!>=55)recommendation='sample_test';
    const nextActions=missing.slice(0,4).map(item=>`补充${item}`);
    if(latest.sourceType!=='authorized_export'){if(recommendation==='sample_test')recommendation='investigate';nextActions.push('取得平台授权导出或已授权店铺数据后再决定投入');}
    if(!previous)nextActions.push('在相同统计口径下补录下一期快照，形成趋势');
    if(recommendation==='sample_test')nextActions.push('设定小额测试预算、停止条件和复盘日期');
    else if(recommendation==='investigate')nextActions.push('复核低分维度后再决定是否打样');
    else if(recommendation==='reject')nextActions.push('记录淘汰原因，暂停内容与采购投入');
    decisions.push({id:[product.id,latest.platform,latest.country].join(':'),productId:product.id,platform:latest.platform,country:latest.country,latestSignalId:latest.id,observedAt:latest.observedAt,sourceType:latest.sourceType,overallScore,confidencePercent,recommendation,dimensions,trend:{previousSignalId:previous?.id||null,unitsSoldChangePercent:unitsTrend,viewsChangePercent:viewsTrend},missing:[...new Set(missing)],nextActions:[...new Set(nextActions)].slice(0,6)});
  }
  return decisions.sort((a,b)=>(b.overallScore??-1)-(a.overallScore??-1)||platformLabel[a.platform].localeCompare(platformLabel[b.platform]));
}
export function assertVersion(actual: number, expected: number) {
  if (actual !== expected) throw new DomainError('VERSION_CONFLICT', '资料已被更新，请刷新后重新操作', 409);
}
export function assertDemoAction(mode: string, action: string) {
  if (mode !== 'local_demo' || ['publish', 'send', 'pay', 'purchase', 'refund'].includes(action)) {
    throw new DomainError('CAPABILITY_UNAVAILABLE', '当前仅开放本地演练，真实对外能力尚未接入', 403);
  }
}
