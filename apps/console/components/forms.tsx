'use client';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Command, CommandResult, Costs, Product } from '@agentsale/contracts';
import { assessCosts, formatMinor, parseMinor } from '@agentsale/domain';
export type SendCommand = (command: Command) => Promise<CommandResult | null>;

export function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} aria-label={title} onCancel={close} onClose={close}><div className="sectionrow"><h2>{title}</h2><button className="icon-button" aria-label="关闭" onClick={close}><X size={18} /></button></div>{children}</dialog>;
}
const fields: [keyof Costs, string, string][] = [
  ['revenueMinor', '预期净销售收入', 'USD'], ['procurementCnyMinor', '工厂采购价', 'CNY'], ['shippingMinor', '全程物流', 'USD'], ['feeMinor', '支付与平台费用', 'USD'], ['afterSaleMinor', '售后额外损耗', 'USD'], ['mediaMinor', '内容与 AI 分摊', 'USD'], ['acquisitionMinor', '获客成本', 'USD']
];
export function CostFields({ initial }: { initial: Costs }) {
  return <div className="form-grid">{fields.map(([key, label, currency]) => <label className="field" key={key}>{label}<span className="input-unit"><input name={key} inputMode="decimal" required={!['procurementCnyMinor','shippingMinor'].includes(key)} defaultValue={initial[key] === null ? '' : (Number(initial[key]) / 100).toFixed(2)} placeholder={initial[key] === null ? '未知，留空' : '0.00'} /><span>{currency}</span></span></label>)}<label className="field">汇率 · 1 美元兑人民币<input name="cnyPerUsdMillion" inputMode="decimal" required defaultValue={initial.cnyPerUsdMillion / 1_000_000} /></label><label className="field">汇率日期<input name="fxDate" type="date" required defaultValue={initial.fxDate}/></label></div>;
}
export function readCosts(form: FormData): Costs {
  const amount = (key: string, nullable = false) => { const value = String(form.get(key) ?? '').trim(); return nullable && !value ? null : parseMinor(value); };
  const fx = String(form.get('cnyPerUsdMillion'));
  if (!/^\d{1,2}(\.\d{1,6})?$/.test(fx)) throw new Error('汇率最多保留六位小数');
  const [whole, fraction = ''] = fx.split('.');
  return { currency: 'USD', revenueMinor: amount('revenueMinor')!, procurementCnyMinor: amount('procurementCnyMinor', true), shippingMinor: amount('shippingMinor', true), feeMinor: amount('feeMinor')!, afterSaleMinor: amount('afterSaleMinor')!, mediaMinor: amount('mediaMinor')!, acquisitionMinor: amount('acquisitionMinor')!, cnyPerUsdMillion: Number(whole) * 1_000_000 + Number(fraction.padEnd(6, '0')), fxDate: String(form.get('fxDate')) };
}
export function CostEditor({ product, send, busy }: { product: Product; send: SendCommand; busy: boolean }) {
  const [preview, setPreview] = useState(product.costs);
  const [invalid, setInvalid] = useState('');
  const result = assessCosts(preview);
  function read(form: HTMLFormElement) { try { const next = readCosts(new FormData(form)); assessCosts(next); setPreview(next); setInvalid(''); return next; } catch (error) { setInvalid(error instanceof Error ? error.message : '请输入有效成本'); return null; } }
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const costs = read(event.currentTarget); if (costs) await send({ type: 'product.costs', id: product.id, expectedVersion: product.version, costs }); }
  return <form onSubmit={save} onChange={event => read(event.currentTarget)}><CostFields initial={product.costs}/>{invalid && <p className="form-error" role="alert">{invalid}</p>}<div className={'result' + ((result.profitMinor ?? 0) < 0 ? ' loss' : '')}><div><span className="small muted">预期贡献利润</span><div><strong>{result.profitMinor === null ? '—' : formatMinor(result.profitMinor)}</strong><span className="small"> / 单</span></div></div><div className="result-rate"><b>{result.marginPercent === null ? '—' : result.marginPercent.toFixed(1) + '%'}</b><div className="small muted">贡献利润率</div></div></div><p className="footnote">{result.complete ? `采购折算 ${formatMinor(result.procurementMinor!)}；获客成本盈亏平衡点 ${formatMinor(result.breakEvenCacMinor!)}。均为情景估算。` : `缺少${result.missing.join('、')}，不展示最终利润。`}</p><p className="footnote">净销售收入已扣除退款及代收税，售后费用仅计额外损耗；不包含固定运营成本。</p><button className="btn primary" type="submit" disabled={busy || !!invalid} style={{ marginTop: 20 }}>保存成本</button></form>;
}
export function ProductForm({ send, close, busy }: { send: SendCommand; close: () => void; busy: boolean }) {
  const [error, setError] = useState('');
  const blankCosts: Costs = { currency:'USD', revenueMinor:0, procurementCnyMinor:null, shippingMinor:null, feeMinor:0, afterSaleMinor:0, mediaMinor:0, acquisitionMinor:0, cnyPerUsdMillion:7200000, fxDate:new Date().toISOString().slice(0,10) };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); const data = new FormData(event.currentTarget);
    try {
      const result = await send({ type:'product.create', name:String(data.get('name')), sku:String(data.get('sku')), supplier:String(data.get('supplier')), region:String(data.get('region')), market:String(data.get('market')), sourceUrl:String(data.get('sourceUrl')), description:String(data.get('description')), costs:readCosts(data) });
      if (result) close();
    } catch (e) { setError(e instanceof Error ? e.message : '请输入有效数据'); }
  }
  return <form onSubmit={submit}><p className="muted small">手动录入商品与来源，不会自动抓取或联系工厂。</p><div className="form-grid spaced"><label className="field">商品名称<input name="name" required maxLength={100}/></label><label className="field">SKU<input name="sku" required pattern="[A-Za-z0-9_\-]+" maxLength={60}/></label><label className="field">工厂 / 供应商<input name="supplier" required maxLength={100}/></label><label className="field">供货地区<input name="region" defaultValue="中国大陆" required maxLength={80}/></label><label className="field">目标市场<input name="market" defaultValue="待确定" required maxLength={80}/></label><label className="field">来源链接<input name="sourceUrl" type="url" placeholder="https://" required maxLength={2000}/></label></div><label className="field spaced">资料备注<textarea name="description" rows={3} maxLength={2000}/></label><h3 className="spaced">成本情景</h3><p className="footnote">未知采购价与物流可留空。初始 7.2 汇率为演练假设，请按实际资料修改。</p><CostFields initial={blankCosts}/>{error && <p className="form-error" role="alert">{error}</p>}<div className="review-actions"><button type="submit" className="btn primary" disabled={busy}>保存商品</button><button type="button" className="btn text" onClick={close}>取消</button></div></form>;
}
export function EvidenceForm({ product, send, close, busy }: { product: Product; send: SendCommand; close: () => void; busy: boolean }) {
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const d = new FormData(event.currentTarget); const result = await send({ type:'evidence.add', productId:product.id, expectedVersion:product.version, title:String(d.get('title')), url:String(d.get('url')), note:String(d.get('note')), confirmed:d.get('confirmed')==='on' }); if (result) close(); }
  return <form onSubmit={submit}><label className="field">资料名称<input name="title" required maxLength={120} placeholder="例如：包装重量与报价"/></label><label className="field spaced">来源链接<input name="url" type="url" required maxLength={2000}/></label><label className="field spaced">摘录与核实说明<textarea name="note" required rows={5} maxLength={2000}/></label><label className="check-field spaced"><input type="checkbox" name="confirmed"/>我已人工核对该资料（本地演练记录）</label><p className="footnote">人工确认只记录你的判断，系统不会声称完成独立核验。新增资料会更新商品版本。</p><div className="review-actions"><button type="submit" className="btn primary" disabled={busy}>保存资料</button><button type="button" className="btn text" onClick={close}>取消</button></div></form>;
}
