import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Repository } from '@agentsale/database';
import type { SecretSettings } from './types';

const messageSchema = z.object({
  id: z.string(),
  sequence: z.number().int().positive(),
  role: z.enum(['user', 'assistant', 'system']),
  kind: z.string(),
  content: z.string(),
  createdAt: z.string()
});

const memorySchema = z.object({
  kind: z.enum(['preference', 'constraint', 'fact', 'decision']),
  subject: z.string().min(1).max(120),
  content: z.string().min(1).max(500),
  confidence: z.number().int().min(0).max(100)
}).strict();

export const contextSummarySchema = z.object({
  objective: z.string().max(1000),
  requirements: z.array(z.string().max(500)).max(24),
  facts: z.array(z.string().max(500)).max(24),
  decisions: z.array(z.string().max(500)).max(20),
  openQuestions: z.array(z.string().max(500)).max(16),
  nextActions: z.array(z.string().max(500)).max(16),
  memories: z.array(memorySchema).max(24)
}).strict();

export type ContextSummary = z.infer<typeof contextSummarySchema>;
type ContextMessage = z.infer<typeof messageSchema>;
export type ContextMemory = z.infer<typeof memorySchema> & { id: string; validFrom: string };
type StoredSummary = { version: number; throughMessageSequence: number; document: ContextSummary };
type SummaryResult = { data: ContextSummary; usage: unknown; model: string };
type Summarizer = (settings: SecretSettings, prompt: string) => Promise<SummaryResult>;
export type ContextPack = {
  runId: string;
  prompt: string;
  estimatedTokens: number;
  summaryVersion: number;
  recentMessageIds: string[];
  memoryIds: string[];
  maintenanceError: string;
};

const MAX_CONTEXT_TOKENS = 12_000;
const COMPACT_AFTER_MESSAGES = 24;
const COMPACT_AFTER_TOKENS = 6_000;
const KEEP_RECENT_MESSAGES = 8;
const MAX_RECENT_MESSAGES = 14;
const COMPACTION_WINDOW_MESSAGES = 120;
const COMPACTION_INPUT_TOKENS = 7_500;
const emptySummary: ContextSummary = { objective: '', requirements: [], facts: [], decisions: [], openQuestions: [], nextActions: [], memories: [] };
const now = () => new Date().toISOString();

export function estimateContextTokens(value: string) {
  let cjk = 0;
  let other = 0;
  for (const char of value) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(char)) cjk++;
    else other++;
  }
  return Math.max(1, Math.ceil(cjk * 1.15 + other / 3.5));
}

function truncateToTokens(value: string, budget: number) {
  if (estimateContextTokens(value) <= budget) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateContextTokens(value.slice(0, middle)) <= budget) low = middle;
    else high = middle - 1;
  }
  return value.slice(0, low) + '…';
}

function terms(value: string) {
  const lower = value.toLowerCase();
  const result = new Set(lower.match(/[a-z0-9][a-z0-9_-]+/g) || []);
  const han = [...lower].filter(char => /[\u3400-\u9fff]/u.test(char));
  for (const char of han) result.add(char);
  for (let index = 0; index < han.length - 1; index++) result.add(han[index] + han[index + 1]);
  return result;
}

export function rankContextMemories(query: string, memories: ContextMemory[], limit = 8) {
  const wanted = terms(query);
  const priority = { constraint: 4, preference: 3, decision: 2, fact: 1 };
  return memories.map(memory => {
    const candidate = terms(memory.subject + ' ' + memory.content);
    let overlap = 0;
    for (const term of wanted) if (candidate.has(term)) overlap++;
    return { memory, score: overlap * 10 + priority[memory.kind] + memory.confidence / 100 };
  }).sort((left, right) => right.score - left.score || right.memory.validFrom.localeCompare(left.memory.validFrom))
    .slice(0, limit)
    .map(item => item.memory);
}

export function createContextManager(repo: Repository, workspace: string, conversationId: string, summarize: Summarizer) {
  const parseMessage = (row: any) => messageSchema.parse({
    id: String(row.id),
    sequence: Number(row.sequence),
    role: row.role,
    kind: String(row.kind),
    content: String(row.content),
    createdAt: String(row.created_at)
  });

  async function loadSummary(): Promise<StoredSummary | null> {
    return repo.scoped(workspace, async tx => {
      const row = (await tx.execute(sql`SELECT version,through_message_sequence,document FROM agent_conversation_context_summaries WHERE workspace_id=${workspace} AND conversation_id=${conversationId}::uuid`)).rows[0] as any;
      return row ? {
        version: Number(row.version),
        throughMessageSequence: Number(row.through_message_sequence),
        document: contextSummarySchema.parse(row.document)
      } : null;
    });
  }

  async function compactionWindow(summary: StoredSummary | null): Promise<ContextMessage[]> {
    return repo.scoped(workspace, async tx => {
      const rows = (await tx.execute(summary
        ? sql`SELECT id,sequence,role,kind,content,created_at FROM commerce_agent_messages WHERE workspace_id=${workspace} AND conversation_id=${conversationId}::uuid AND sequence>${summary.throughMessageSequence} ORDER BY sequence LIMIT ${COMPACTION_WINDOW_MESSAGES}`
        : sql`SELECT id,sequence,role,kind,content,created_at FROM commerce_agent_messages WHERE workspace_id=${workspace} AND conversation_id=${conversationId}::uuid ORDER BY sequence LIMIT ${COMPACTION_WINDOW_MESSAGES}`)).rows;
      return rows.map(parseMessage);
    });
  }

  async function recentMessages(summary: StoredSummary | null): Promise<ContextMessage[]> {
    return repo.scoped(workspace, async tx => {
      const rows = (await tx.execute(summary
        ? sql`SELECT id,sequence,role,kind,content,created_at FROM commerce_agent_messages WHERE workspace_id=${workspace} AND conversation_id=${conversationId}::uuid AND sequence>${summary.throughMessageSequence} ORDER BY sequence DESC LIMIT ${MAX_RECENT_MESSAGES}`
        : sql`SELECT id,sequence,role,kind,content,created_at FROM commerce_agent_messages WHERE workspace_id=${workspace} AND conversation_id=${conversationId}::uuid ORDER BY sequence DESC LIMIT ${MAX_RECENT_MESSAGES}`)).rows;
      return rows.reverse().map(parseMessage);
    });
  }

  async function activeMemories(): Promise<ContextMemory[]> {
    return repo.scoped(workspace, async tx => (await tx.execute(sql`SELECT id,kind,subject,content,confidence,valid_from FROM agent_conversation_memories WHERE workspace_id=${workspace} AND conversation_id=${conversationId}::uuid AND valid_to='' ORDER BY valid_from DESC LIMIT 200`)).rows.map((row: any) => ({
      id: String(row.id),
      kind: memorySchema.shape.kind.parse(row.kind),
      subject: String(row.subject),
      content: String(row.content),
      confidence: Number(row.confidence),
      validFrom: String(row.valid_from)
    })));
  }

  async function persistCompaction(expectedVersion: number, cutoff: ContextMessage, document: ContextSummary, sourceIds: string[]) {
    await repo.scoped(workspace, async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${workspace}))`);
      const current = (await tx.execute(sql`SELECT version FROM agent_conversation_context_summaries WHERE workspace_id=${workspace} AND conversation_id=${conversationId}::uuid`)).rows[0] as any;
      if (Number(current?.version || 0) !== expectedVersion) return;

      const stamp = now();
      const version = expectedVersion + 1;
      await tx.execute(sql`INSERT INTO agent_conversation_context_summaries(workspace_id,conversation_id,version,through_message_sequence,document,updated_at) VALUES(${workspace},${conversationId}::uuid,${version},${cutoff.sequence},${JSON.stringify(document)}::jsonb,${stamp}) ON CONFLICT(workspace_id,conversation_id) DO UPDATE SET version=excluded.version,through_message_sequence=excluded.through_message_sequence,document=excluded.document,updated_at=excluded.updated_at`);

      const active = (await tx.execute(sql`SELECT id,kind,subject,content FROM agent_conversation_memories WHERE workspace_id=${workspace} AND conversation_id=${conversationId}::uuid AND valid_to=''`)).rows as any[];
      const key = (kind: string, subject: string) => kind + '\u0000' + subject.trim().toLocaleLowerCase();
      const desiredKeys = new Set(document.memories.map(memory => key(memory.kind, memory.subject)));
      for (const existing of active) {
        if (!desiredKeys.has(key(String(existing.kind), String(existing.subject)))) {
          await tx.execute(sql`UPDATE agent_conversation_memories SET valid_to=${stamp} WHERE id=${String(existing.id)}::uuid`);
        }
      }

      for (const memory of document.memories) {
        const existing = active.find(item => key(String(item.kind), String(item.subject)) === key(memory.kind, memory.subject));
        if (existing && String(existing.content) === memory.content) continue;
        if (existing) await tx.execute(sql`UPDATE agent_conversation_memories SET valid_to=${stamp} WHERE id=${String(existing.id)}::uuid`);
        await tx.execute(sql`INSERT INTO agent_conversation_memories(id,workspace_id,conversation_id,kind,subject,content,confidence,source_message_ids,valid_from,valid_to) VALUES(${randomUUID()}::uuid,${workspace},${conversationId}::uuid,${memory.kind},${memory.subject},${memory.content},${memory.confidence},${JSON.stringify(sourceIds)}::jsonb,${stamp},'')`);
      }
    });
  }

  async function compactIfNeeded(settings: SecretSettings, stateContext: unknown, summary: StoredSummary | null, messages: ContextMessage[]) {
    const tokenCount = messages.reduce((total, message) => total + estimateContextTokens(message.content), 0);
    if (messages.length < COMPACT_AFTER_MESSAGES && tokenCount < COMPACT_AFTER_TOKENS) return '';

    const eligible = messages.slice(0, -KEEP_RECENT_MESSAGES);
    const selected: ContextMessage[] = [];
    let used = 0;
    for (const message of eligible) {
      const cost = estimateContextTokens(message.content) + 20;
      if (selected.length && used + cost > COMPACTION_INPUT_TOKENS) break;
      selected.push(message);
      used += cost;
    }
    if (!selected.length) return '';

    const prompt = `你负责维护自动化电商 Agent 的长期上下文。根据旧摘要和新增消息生成一份完整的新摘要。只保留用户明确表达、系统真实记录或可由消息直接支持的信息；不得补充外部销量、供应商能力、订单、报价或执行结果。requirements 保存长期要求，facts 保存已确认事实，decisions 保存已作决定及理由，openQuestions 保存仍缺的信息，nextActions 保存已经约定但未完成的动作。memories 只提取跨会话仍有价值的偏好、约束、事实或决定；相同 subject 只输出当前有效版本。\n当前结构化状态：${JSON.stringify(stateContext)}\n旧摘要：${JSON.stringify(summary?.document || emptySummary)}\n新增消息：${JSON.stringify(selected.map(({ id, sequence, role, kind, content, createdAt }) => ({ id, sequence, role, kind, content, createdAt })))}`;
    try {
      const result = await summarize(settings, prompt);
      await persistCompaction(summary?.version || 0, selected.at(-1)!, result.data, selected.map(message => message.id));
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : '上下文压缩失败';
    }
  }

  function assemble(stateContext: unknown, summary: StoredSummary | null, memories: ContextMemory[], messages: ContextMessage[]) {
    const state = truncateToTokens(JSON.stringify(stateContext), 2_000);
    const summaryText = truncateToTokens(JSON.stringify(summary?.document || emptySummary), 2_600);
    const ranked = rankContextMemories(messages.at(-1)?.content || '', memories);
    const memoryText = truncateToTokens(JSON.stringify(ranked.map(({ id: _, ...memory }) => memory)), 1_800);
    let remaining = MAX_CONTEXT_TOKENS - estimateContextTokens(state) - estimateContextTokens(summaryText) - estimateContextTokens(memoryText) - 500;
    const recent: ContextMessage[] = [];

    for (const message of messages.slice().reverse()) {
      const content = truncateToTokens(message.content, Math.max(200, remaining));
      const cost = estimateContextTokens(content) + 30;
      if (recent.length && cost > remaining) break;
      recent.unshift({ ...message, content });
      remaining -= cost;
      if (remaining <= 200) break;
    }

    const prompt = `<agent_state>${state}</agent_state>\n<conversation_summary version="${summary?.version || 0}">${summaryText}</conversation_summary>\n<relevant_memories>${memoryText}</relevant_memories>\n<recent_messages>${JSON.stringify(recent.map(({ id, sequence, role, kind, content, createdAt }) => ({ id, sequence, role, kind, content, createdAt })))}</recent_messages>`;
    return { prompt, estimatedTokens: estimateContextTokens(prompt), recent, ranked };
  }

  async function prepare(settings: SecretSettings, currentMessageId: string, stateContext: unknown): Promise<ContextPack> {
    let summary = await loadSummary();
    const maintenanceError = await compactIfNeeded(settings, stateContext, summary, await compactionWindow(summary));
    if (!maintenanceError) summary = await loadSummary();

    const [messages, memories] = await Promise.all([recentMessages(summary), activeMemories()]);
    const assembled = assemble(stateContext, summary, memories, messages);
    const runId = randomUUID();
    await repo.scoped(workspace, async tx => {
      await tx.execute(sql`INSERT INTO agent_conversation_context_runs(id,workspace_id,conversation_id,message_id,summary_version,recent_message_ids,memory_ids,estimated_tokens,status,maintenance_error,usage,created_at,completed_at) VALUES(${runId}::uuid,${workspace},${conversationId}::uuid,${currentMessageId}::uuid,${summary?.version || 0},${JSON.stringify(assembled.recent.map(message => message.id))}::jsonb,${JSON.stringify(assembled.ranked.map(memory => memory.id))}::jsonb,${assembled.estimatedTokens},'prepared',${maintenanceError},'null'::jsonb,${now()},'')`);
    });

    return {
      runId,
      prompt: assembled.prompt,
      estimatedTokens: assembled.estimatedTokens,
      summaryVersion: summary?.version || 0,
      recentMessageIds: assembled.recent.map(message => message.id),
      memoryIds: assembled.ranked.map(memory => memory.id),
      maintenanceError
    };
  }

  async function finish(runId: string, status: 'completed' | 'failed', usage: unknown) {
    await repo.scoped(workspace, async tx => {
      await tx.execute(sql`UPDATE agent_conversation_context_runs SET status=${status},usage=${JSON.stringify(usage ?? null)}::jsonb,completed_at=${now()} WHERE id=${runId}::uuid AND conversation_id=${conversationId}::uuid`);
    });
  }

  async function snapshot() {
    const [summary, memories] = await Promise.all([loadSummary(), activeMemories()]);
    return repo.scoped(workspace, async tx => ({
      summary,
      memories,
      runs: (await tx.execute(sql`SELECT id,status,summary_version,estimated_tokens,recent_message_ids,memory_ids,maintenance_error FROM agent_conversation_context_runs WHERE workspace_id=${workspace} AND conversation_id=${conversationId}::uuid ORDER BY created_at DESC LIMIT 100`)).rows
    }));
  }

  return { prepare, finish, snapshot };
}
