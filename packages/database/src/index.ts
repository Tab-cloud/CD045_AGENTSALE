import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, desc, eq, sql } from 'drizzle-orm';
import { randomUUID, createHash } from 'node:crypto';
import { commandSchema, defaultCosts, type Command, type CommandResult, type MarketSignal, type Snapshot } from '@agentsale/contracts';
import { assertDemoAction, assertVersion, assessCosts, buildMarketDecisions, DomainError, formatMinor } from '@agentsale/domain';
import * as schema from './schema';
import { migration } from './migration';
import { automationMigration } from './automation-migration';
import { knowledgeMigration } from './knowledge-migration';
import { membershipMigration } from './membership-migration';

export const LOCAL_WORKSPACE = 'local-rehearsal';
export async function createRepository(dataDir?: string) {
  const client = new PGlite(dataDir);
  try { await client.exec(migration); await client.exec(automationMigration); await client.exec(membershipMigration); await client.exec(knowledgeMigration); }
  catch (error) { await client.close().catch(() => {}); throw error; }
  const db = drizzle(client, { schema });
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
  async function scoped<T>(workspace: string, operation: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async tx => {
      await tx.execute(sql.raw('SET LOCAL ROLE agentsale_local'));
      await tx.execute(sql`SELECT set_config('agentsale.workspace', ${workspace}, true)`);
      return operation(tx);
    });
  }
  const stamp = () => new Date().toISOString();
  async function record(tx: Tx, workspaceId: string, action: string, objectId: string, summary: string) {
    await tx.insert(schema.audit).values({ id: randomUUID(), workspaceId, action, objectId, summary, createdAt: stamp() });
  }
  async function getProduct(tx: Tx, workspaceId: string, id: string) {
    const [product] = await tx.select().from(schema.products).where(and(eq(schema.products.workspaceId, workspaceId), eq(schema.products.id, id))).for('update');
    if (!product) throw new DomainError('NOT_FOUND', '商品不存在或不属于当前工作区', 404);
    return product;
  }
  async function seed(workspaceId = LOCAL_WORKSPACE) {
    return scoped(workspaceId, async tx => {
      const existing = await tx.select({ id: schema.products.id }).from(schema.products).limit(1);
      if (existing.length) return;
      const now = stamp();
      const examples = [
        { name: '折叠桌面支架', sku: 'DEMO-001', supplier: '示例工厂 A', region: '中国大陆 · 示例地区', costs: defaultCosts, description: '折叠结构与适用设备尚待样品核实。用于本地演练的商品。' },
        { name: '旅行收纳包', sku: 'DEMO-002', supplier: '示例工厂 B', region: '中国大陆 · 示例地区', costs: { ...defaultCosts, shippingMinor: null }, description: '包装尺寸及国际运费尚未取得。' },
        { name: '桌面理线夹', sku: 'DEMO-003', supplier: '示例工厂 C', region: '中国大陆 · 示例地区', costs: { ...defaultCosts, procurementCnyMinor: null, shippingMinor: null }, description: '正在整理供货规格，尚无有效报价。' }
      ];
      for (const item of examples) {
        const id = randomUUID();
        await tx.insert(schema.products).values({ ...item, id, workspaceId, market: '待确定', sourceUrl: 'https://example.com/product/' + item.sku, sample: true, version: 1, createdAt: now, updatedAt: now });
        await tx.insert(schema.evidence).values({ id: randomUUID(), workspaceId, productId: id, title: '商品来源', url: 'https://example.com/product/' + item.sku, note: '占位来源，仅用于演练，未抓取或核实网页。', confirmed: false, createdAt: now });
      }
      await record(tx, workspaceId, 'workspace.seed', workspaceId, '已建立本地演练工作区，载入 3 款示例商品');
    });
  }
  async function snapshot(workspaceId = LOCAL_WORKSPACE): Promise<Snapshot> {
    return scoped(workspaceId, async tx => {
      const products=await tx.select().from(schema.products).orderBy(schema.products.createdAt);
      const evidence=await tx.select().from(schema.evidence).orderBy(desc(schema.evidence.createdAt));
      const rows=await tx.select().from(schema.marketSignals).orderBy(desc(schema.marketSignals.observedAt),desc(schema.marketSignals.createdAt));
      const marketSignals:MarketSignal[]=rows.map(row=>{const {metrics,...identity}=row;return {...identity,...metrics};});
      return {workspace:{id:workspaceId,name:'出海经营工作区',mode:'local_demo'},products,evidence,marketSignals,
        decisions:buildMarketDecisions(products,evidence,marketSignals),
        drafts:await tx.select().from(schema.drafts).orderBy(desc(schema.drafts.createdAt)),
        runs:await tx.select().from(schema.runs).orderBy(desc(schema.runs.createdAt)),
        audit:await tx.select().from(schema.audit).orderBy(desc(schema.audit.createdAt)).limit(80)};
    });
  }
  async function execute(workspaceId: string, rawCommand: unknown, key: string): Promise<CommandResult> {
    assertDemoAction('local_demo', 'local');
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key)) throw new DomainError('IDEMPOTENCY_REQUIRED', '操作缺少有效标识，请重新提交');
    const parsed = commandSchema.safeParse(rawCommand);
    if (!parsed.success) throw new DomainError('INPUT_INVALID', parsed.error.issues.map(i => i.message).join('；'));
    const command: Command = parsed.data;
    const hash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    return scoped(workspaceId, async tx => {
      const [cached] = await tx.select().from(schema.idempotency).where(and(eq(schema.idempotency.workspaceId, workspaceId), eq(schema.idempotency.key, key)));
      if (cached) {
        if (cached.hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '同一操作标识不能用于不同内容', 409);
        return cached.result;
      }
      let result: CommandResult;
      const now = stamp();
      if (command.type === 'product.create') {
        const { type: _, ...fields } = command;
        const duplicates = await tx.select().from(schema.products).where(eq(schema.products.sku, fields.sku));
        if (duplicates.length) throw new DomainError('DUPLICATE_SKU', '该 SKU 已存在，请使用其他编号', 409);
        const id = randomUUID();
        await tx.insert(schema.products).values({ ...fields, id, workspaceId, sample: false, version: 1, createdAt: now, updatedAt: now });
        await tx.insert(schema.evidence).values({ id: randomUUID(), workspaceId, productId: id, title: '录入来源', url: fields.sourceUrl, note: '由运营人员录入，尚未核实来源。', confirmed: false, createdAt: now });
        result = { id, message: '商品已保存，来源尚待核实' };
      } else if(command.type==='market.snapshot.add'){
        const product=await getProduct(tx,workspaceId,command.productId);assertVersion(product.version,command.expectedProductVersion);
        const id=randomUUID(),{platform,country,observedAt,sourceType,sourceRef,...metrics}=command.signal;
        await tx.insert(schema.marketSignals).values({id,workspaceId,productId:product.id,platform,country,observedAt,sourceType,sourceRef,metrics,createdAt:now});
        result={id,message:`已保存 ${country} 市场快照，决策评分已更新`};
      } else if (command.type === 'product.costs' || command.type === 'evidence.add' || command.type === 'run.create') {
        const product = await getProduct(tx, workspaceId, command.type === 'product.costs' ? command.id : command.productId);
        assertVersion(product.version, command.expectedVersion);
        if (command.type === 'product.costs') {
          await tx.update(schema.products).set({ costs: command.costs, version: product.version + 1, updatedAt: now }).where(eq(schema.products.id, product.id));
          result = { id: product.id, message: '成本已保存，旧版内容需重新核对' };
        } else if (command.type === 'evidence.add') {
          const id = randomUUID();
          await tx.insert(schema.evidence).values({ id, workspaceId, productId: product.id, title: command.title, url: command.url, note: command.note, confirmed: command.confirmed, createdAt: now });
          await tx.update(schema.products).set({ version: product.version + 1, updatedAt: now }).where(eq(schema.products.id, product.id));
          result = { id, message: '来源记录已保存' };
        } else {
          const id = randomUUID();
          await tx.insert(schema.runs).values({ id, workspaceId, productId: product.id, productVersion: product.version, kind: command.kind, state: 'queued', version: 1, summary: '等待本地任务处理', createdAt: now, updatedAt: now });
          result = { id, message: '任务已排队，可在任务页查看结果' };
        }
      } else if (command.type === 'draft.edit' || command.type === 'draft.review') {
        const [draft] = await tx.select().from(schema.drafts).where(eq(schema.drafts.id, command.id)).for('update');
        if (!draft) throw new DomainError('NOT_FOUND', '草稿不存在', 404);
        assertVersion(draft.version, command.expectedVersion);
        const product = await getProduct(tx, workspaceId, draft.productId);
        if (command.type === 'draft.edit') {
          assertVersion(product.version, command.expectedProductVersion);
          await tx.update(schema.drafts).set({ script: command.script, productVersion: product.version, state: 'review_required', version: draft.version + 1 }).where(eq(schema.drafts.id, draft.id));
          result = { id: draft.id, message: '脚本已保存，等待重新审阅' };
        } else {
          if (command.decision === 'approve') assertVersion(product.version, draft.productVersion);
          await tx.update(schema.drafts).set({ state: command.decision === 'approve' ? 'approved' : 'review_required', version: draft.version + 1 }).where(eq(schema.drafts.id, draft.id));
          result = { id: draft.id, message: command.decision === 'approve' ? '脚本审阅已保存，未进行发布' : '已撤回脚本审阅' };
        }
      } else {
        const [run] = await tx.select().from(schema.runs).where(eq(schema.runs.id, command.id)).for('update');
        if (!run) throw new DomainError('NOT_FOUND', '任务不存在', 404);
        assertVersion(run.version, command.expectedVersion);
        const required = command.type === 'run.pause' ? 'queued' : 'paused';
        if (run.state !== required) throw new DomainError('INVALID_STATE', '当前任务状态不支持此操作', 409);
        await tx.update(schema.runs).set({ state: command.type === 'run.pause' ? 'paused' : 'queued', version: run.version + 1, updatedAt: now }).where(eq(schema.runs.id, run.id));
        result = { id: run.id, message: command.type === 'run.pause' ? '任务已暂停' : '任务已继续' };
      }
      await record(tx, workspaceId, command.type, result.id, result.message);
      await tx.insert(schema.idempotency).values({ workspaceId, key, hash, result });
      return result;
    });
  }
  async function processOne(workspaceId = LOCAL_WORKSPACE): Promise<boolean> {
    return scoped(workspaceId, async tx => {
      const [run] = await tx.select().from(schema.runs).where(eq(schema.runs.state, 'queued')).orderBy(schema.runs.createdAt).limit(1).for('update', { skipLocked: true });
      if (!run) return false;
      const product = await getProduct(tx, workspaceId, run.productId);
      let summary: string;
      let state: 'succeeded' | 'failed' = 'succeeded';
      if (product.version !== run.productVersion) {
        summary = '商品资料已变化，请依据最新资料重新创建任务'; state = 'failed';
      } else if (run.kind === 'assessment') {
        const assessment = assessCosts(product.costs);
        summary = assessment.complete ? `情景测算完成：每单预期贡献 ${formatMinor(assessment.profitMinor!)}。市场、供货与素材授权仍需核实。` : `待补充 ${assessment.missing.join('、')}，未生成最终利润。`;
      } else {
        await tx.insert(schema.drafts).values({ id: randomUUID(), workspaceId, productId: product.id, productVersion: product.version, version: 1, state: 'review_required', createdAt: stamp(), script: `00–05s · 场景开头\nShow the product in its intended setting.\n\n05–14s · 商品展示\n[Insert verified features and actual product footage.]\n\n14–20s · 了解详情\nExplore the product details.\n\n编辑备注：${product.name}。请核对产品规格、适用设备及素材授权。此稿由本地模板生成，未调用 AI 或渲染视频。` });
        summary = '已创建本地模板草稿，等待内容审阅；没有生成或发布视频';
      }
      await tx.update(schema.runs).set({ state, version: run.version + 1, summary, updatedAt: stamp() }).where(eq(schema.runs.id, run.id));
      await record(tx, workspaceId, 'run.' + state, run.id, summary);
      return true;
    });
  }
  return { seed, snapshot, execute, processOne, close: () => client.close(), scoped, db };
}
export type Repository = Awaited<ReturnType<typeof createRepository>>;
