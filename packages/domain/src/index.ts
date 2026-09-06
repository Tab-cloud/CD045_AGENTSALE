import { costsSchema, type Costs } from '@agentsale/contracts';

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
export function assertVersion(actual: number, expected: number) {
  if (actual !== expected) throw new DomainError('VERSION_CONFLICT', '资料已被更新，请刷新后重新操作', 409);
}
export function assertDemoAction(mode: string, action: string) {
  if (mode !== 'local_demo' || ['publish', 'send', 'pay', 'purchase', 'refund'].includes(action)) {
    throw new DomainError('CAPABILITY_UNAVAILABLE', '当前仅开放本地演练，真实对外能力尚未接入', 403);
  }
}
