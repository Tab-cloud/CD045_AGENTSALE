import { describe, expect, it } from 'vitest';
import { defaultCosts } from '../packages/contracts/src/index';
import { assessCosts, assertDemoAction, convertCnyMinor, parseMinor } from '../packages/domain/src/index';

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
