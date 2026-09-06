import { z } from 'zod';

const minor = z.number().int().min(0).max(100_000_000);
export const costsSchema = z.object({
  currency: z.literal('USD'), revenueMinor: minor, procurementCnyMinor: minor.nullable(),
  cnyPerUsdMillion: z.number().int().min(1_000_000).max(100_000_000),
  fxDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shippingMinor: minor.nullable(), feeMinor: minor, afterSaleMinor: minor,
  mediaMinor: minor, acquisitionMinor: minor
}).strict();
export type Costs = z.infer<typeof costsSchema>;
const publicUrl = z.string().trim().max(2000).refine(value => {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
}, '请输入不含账号密码的 HTTP 或 HTTPS 链接');
const text = (max: number) => z.string().trim().min(1).max(max);
const productFields = { name: text(100), sku: text(60).regex(/^[\w-]+$/, 'SKU 仅允许字母、数字、下划线和连字符'), supplier: text(100), region: text(80), market: text(80), description: z.string().trim().max(2000), sourceUrl: publicUrl };
const id = z.string().uuid();
const optionalCount = (max: number) => z.number().int().min(0).max(max).nullable();
export const marketSignalInputSchema = z.object({
  platform: z.enum(['tiktok_shop', 'temu', 'amazon', 'shopify', 'other']),
  country: text(80), observedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '观察日期格式应为 YYYY-MM-DD'),
  sourceType: z.enum(['authorized_export', 'public_observation', 'manual']), sourceRef: text(500),
  unitsSold7d: optionalCount(10_000_000), views7d: optionalCount(1_000_000_000),
  reviewCount: optionalCount(100_000_000), ratingHundredths: optionalCount(500),
  engagementRateBps: optionalCount(10_000), competitorCount: optionalCount(1_000_000),
  medianPriceMinor: optionalCount(100_000_000), deliveryDays: optionalCount(365),
  refundRateBps: optionalCount(10_000), notes: z.string().trim().max(2000)
}).strict();
export type MarketSignalInput = z.infer<typeof marketSignalInputSchema>;
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('product.create'), ...productFields, costs: costsSchema }).strict(),
  z.object({ type: z.literal('product.costs'), id, expectedVersion: z.number().int().positive(), costs: costsSchema }).strict(),
  z.object({ type: z.literal('evidence.add'), productId: id, expectedVersion: z.number().int().positive(), title: text(120), url: publicUrl, note: text(2000), confirmed: z.boolean() }).strict(),
  z.object({ type: z.literal('market.snapshot.add'), productId: id, expectedProductVersion: z.number().int().positive(), signal: marketSignalInputSchema }).strict(),
  z.object({ type: z.literal('run.create'), productId: id, expectedVersion: z.number().int().positive(), kind: z.enum(['assessment', 'content']) }).strict(),
  z.object({ type: z.literal('run.pause'), id, expectedVersion: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('run.resume'), id, expectedVersion: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('draft.review'), id, expectedVersion: z.number().int().positive(), decision: z.enum(['approve', 'reopen']) }).strict(),
  z.object({ type: z.literal('draft.edit'), id, expectedVersion: z.number().int().positive(), expectedProductVersion: z.number().int().positive(), script: text(12000) }).strict()
]);
export type Command = z.infer<typeof commandSchema>;
export type Product = { id: string; workspaceId: string; name: string; sku: string; supplier: string; region: string; market: string; description: string; sourceUrl: string; costs: Costs; version: number; sample: boolean; createdAt: string; updatedAt: string };
export type Evidence = { id: string; workspaceId: string; productId: string; title: string; url: string; note: string; confirmed: boolean; createdAt: string };
export type Draft = { id: string; workspaceId: string; productId: string; productVersion: number; script: string; state: 'review_required' | 'approved'; version: number; createdAt: string };
export type Run = { id: string; workspaceId: string; productId: string; productVersion: number; kind: 'assessment' | 'content'; state: 'queued' | 'paused' | 'succeeded' | 'failed'; version: number; summary: string; createdAt: string; updatedAt: string };
export type Audit = { id: string; workspaceId: string; action: string; objectId: string; summary: string; createdAt: string };
export type MarketSignal = MarketSignalInput & { id:string; workspaceId:string; productId:string; createdAt:string };
export type DecisionDimension = { score:number|null; coveragePercent:number; explanation:string[] };
export type MarketDecision = {
  id:string; productId:string; platform:MarketSignalInput['platform']; country:string; latestSignalId:string;
  observedAt:string; sourceType:MarketSignalInput['sourceType']; overallScore:number|null; confidencePercent:number;
  recommendation:'insufficient_data'|'sample_test'|'investigate'|'reject';
  dimensions:{demand:DecisionDimension;competition:DecisionDimension;content:DecisionDimension;fulfillment:DecisionDimension;economics:DecisionDimension};
  trend:{previousSignalId:string|null;unitsSoldChangePercent:number|null;viewsChangePercent:number|null};
  missing:string[]; nextActions:string[];
};
export type Snapshot = { workspace: { id: string; name: string; mode: 'local_demo' }; products: Product[]; evidence: Evidence[]; marketSignals:MarketSignal[]; decisions:MarketDecision[]; drafts: Draft[]; runs: Run[]; audit: Audit[] };
export type CommandResult = { id: string; message: string };

export const defaultCosts: Costs = { currency: 'USD', revenueMinor: 2990, procurementCnyMinor: 4464, cnyPerUsdMillion: 7200000, fxDate: '2026-09-06', shippingMinor: 560, feeMinor: 150, afterSaleMinor: 100, mediaMinor: 60, acquisitionMinor: 600 };
