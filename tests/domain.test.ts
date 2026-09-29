import { describe, expect, it } from 'vitest';
import { defaultCosts, type MarketSignal, type Product } from '../packages/contracts/src/index';
import { assessCosts, assertDemoAction, buildMarketDecisions, convertCnyMinor, parseMinor } from '../packages/domain/src/index';

const decisionProduct:Product={id:'00000000-0000-4000-8000-000000000001',workspaceId:'test',name:'测试商品',sku:'D-1',supplier:'测试工厂',region:'中国大陆',market:'美国',description:'',sourceUrl:'https://example.com',costs:defaultCosts,version:1,sample:false,createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'};
const signal=(overrides:Partial<MarketSignal>={}):MarketSignal=>({id:'00000000-0000-4000-8000-000000000002',workspaceId:'test',productId:decisionProduct.id,platform:'tiktok_shop',country:'美国',observedAt:new Date().toISOString().slice(0,10),sourceType:'authorized_export',sourceRef:'授权店铺导出',unitsSold7d:180,views7d:500000,reviewCount:1200,ratingHundredths:470,engagementRateBps:450,competitorCount:8,medianPriceMinor:3290,deliveryDays:8,refundRateBps:350,notes:'测试快照',createdAt:new Date().toISOString(),...overrides});

describe('精确金额与情景评估', () => {
  it('用整数处理小数金额，拒绝负数与过多小数', () => {
    expect(parseMinor('0.10') + parseMinor('0.20')).toBe(30);
    expect(parseMinor('29.9')).toBe(2990);
    expect(() => parseMinor('-1')).toThrow();
    expect(() => parseMinor('1.005')).toThrow();
  });
  it('人民币报价按固定快照转换，不使用浮点直接结算', () => {
    expect(convertCnyMinor(4464, 7200000)).toBe(620);
    expect(convertCnyMinor(1, 2000000)).toBe(1);
    expect(assessCosts(defaultCosts).profitMinor).toBe(900);
  });
  it('缺少采购或运费时不生成最终利润', () => {
    const result=assessCosts({...defaultCosts,shippingMinor:null,procurementCnyMinor:null});
    expect(result.profitMinor).toBeNull();expect(result.missing).toEqual(['采购报价','国际运费']);
  });
  it('支持真实零值、盈亏平衡与负贡献', () => {
    expect(assessCosts({...defaultCosts,shippingMinor:0}).profitMinor).toBe(1460);
    expect(assessCosts({...defaultCosts,acquisitionMinor:1500}).profitMinor).toBe(0);
    expect(assessCosts({...defaultCosts,acquisitionMinor:2000}).profitMinor).toBe(-500);
  });
  it('拒绝无效汇率并处理零收入', () => {
    expect(()=>assessCosts({...defaultCosts,cnyPerUsdMillion:0})).toThrow();
    expect(assessCosts({...defaultCosts,revenueMinor:0}).marginPercent).toBeNull();
  });
  it('本地演练拒绝真实支付、发送和发布', () => {
    for(const action of ['publish','send','pay','purchase','refund']) expect(()=>assertDemoAction('local_demo',action)).toThrow();
    expect(()=>assertDemoAction('production','local')).toThrow();
  });
});

describe('市场决策评分',()=>{
  it('用完整授权数据生成可解释的打样建议',()=>{
    const result=buildMarketDecisions([decisionProduct],[{id:'e1',workspaceId:'test',productId:decisionProduct.id,title:'报价',url:'https://example.com/e',note:'已确认',confirmed:true,createdAt:new Date().toISOString()}],[signal()])[0];
    expect(result.recommendation).toBe('sample_test');expect(result.overallScore).toBeGreaterThanOrEqual(72);expect(result.confidencePercent).toBeGreaterThan(80);
    expect(result.dimensions.demand.explanation.join(' ')).toContain('近 7 日销量 180');
  });
  it('缺少市场需求时不输出虚假推荐，并能计算同口径趋势',()=>{
    const old=signal({id:'00000000-0000-4000-8000-000000000003',observedAt:'2026-09-01',unitsSold7d:100,views7d:200000,createdAt:'2026-09-01T00:00:00Z'}),latest=signal({unitsSold7d:150,views7d:300000});
    const trended=buildMarketDecisions([decisionProduct],[],[old,latest])[0];expect(trended.trend.unitsSoldChangePercent).toBe(50);expect(trended.trend.viewsChangePercent).toBe(50);
    const incomplete=buildMarketDecisions([decisionProduct],[],[signal({unitsSold7d:null,views7d:null,reviewCount:null,ratingHundredths:null,engagementRateBps:null})])[0];
    expect(incomplete.recommendation).toBe('insufficient_data');expect(incomplete.missing).toContain('近 7 日销量');expect(incomplete.dimensions.demand.score).toBeNull();
  });
  it('公开观察即使高分也只进入继续调研',()=>{
    const result=buildMarketDecisions([decisionProduct],[{id:'e1',workspaceId:'test',productId:decisionProduct.id,title:'报价',url:'https://example.com/e',note:'已确认',confirmed:true,createdAt:new Date().toISOString()}],[signal({sourceType:'public_observation'})])[0];
    expect(result.recommendation).toBe('investigate');expect(result.nextActions.join(' ')).toContain('平台授权导出');
  });
});
