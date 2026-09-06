import { z } from 'zod';
import type { Product } from '@agentsale/contracts';

const text = (max: number) => z.string().trim().min(1).max(max);
export const minimaxSchema=z.object({baseUrl:z.enum(['https://api.minimax.cn/v1','https://api.minimaxi.com/v1','https://api.minimax.io/v1']).default('https://api.minimax.cn/v1'),speechModel:text(100).default('speech-2.8-hd'),voiceId:text(100).default('English_Trustworthy_Man'),videoModel:z.enum(['MiniMax-Hailuo-2.3','MiniMax-Hailuo-2.3-Fast','MiniMax-Hailuo-02']).default('MiniMax-Hailuo-2.3'),speechLimitCents:z.number().int().min(0).max(10000).default(0),videoLimitCents:z.number().int().min(0).max(10000).default(0)}).strict();
export const settingsSchema = z.object({
  baseUrl: z.string().url().max(500), model: text(100),
  localModel: z.boolean(), format: z.enum(['json_schema','json_object','prompt_json']),protocol:z.enum(['openai','minimax']).default('openai'),minimax:minimaxSchema.default(()=>minimaxSchema.parse({})),
  tokenParameter: z.enum(['max_completion_tokens','max_tokens']), maxTokens: z.number().int().min(512).max(8192),
  callLimitCents: z.number().int().min(0).max(10000), dailyLimitCents: z.number().int().min(0).max(100000),
  searchCallCents: z.number().int().min(1).max(1000), allowedDomains: z.array(text(253)).max(30)
}).strict();
export type Settings = z.infer<typeof settingsSchema>;
export type SecretSettings = Settings & { apiKey: string; searchKey: string; minimaxKey:string; verifiedAt: string | null; revision: string };
export type PublicSettings = Settings & { hasApiKey: boolean; hasSearchKey: boolean;hasMinimaxKey:boolean; verifiedAt: string | null; revision: string };
export const defaults: Settings = { baseUrl:'https://api.openai.com/v1',model:'',localModel:false,format:'json_schema',protocol:'openai',minimax:minimaxSchema.parse({}),tokenParameter:'max_completion_tokens',maxTokens:4096,callLimitCents:0,dailyLimitCents:0,searchCallCents:1,allowedDomains:[] };
export type User = { id:string; username:string; role:'admin'|'operator'; enabled:boolean };
export type Source = { id:string; url:string; title:string; text:string; hash:string; fetchedAt:string; status:'fetched'|'imported'|'unavailable'; error?:string };
export const citationSchema = z.object({ sourceId:text(100), quote:text(500) }).strict();
export const researchSchema = z.object({
  summary:text(1500), recommendation:z.enum(['investigate','sample_test','reject']),
  candidates:z.array(z.object({ name:text(150),product:text(150),sourceId:text(100),
    mainlandEvidence:citationSchema.nullable(), dropshipEvidence:citationSchema.nullable(),
    markets:z.array(z.object({country:text(100),shippingEvidence:citationSchema,rationale:text(600)}).strict()).max(8),
    concerns:z.array(text(400)).max(10)
  }).strict()).min(1).max(6),
  selectedIndex:z.number().int().min(0).max(5).nullable(), market:text(100).nullable(),
  reasoning:text(1800), missing:z.array(text(400)).max(15),
  inquiry:z.object({subject:text(200),body:text(5000)}).strict()
}).strict();
export type Research = z.infer<typeof researchSchema>;
export const listingSchema=z.object({language:text(80),title:text(180),summary:text(500),description:text(5000),bullets:z.array(text(400)).min(1).max(8),specifications:z.array(z.object({name:text(100),value:text(300),sourceId:text(100)}).strict()).max(20),seoTitle:text(80),seoDescription:text(200),keywords:z.array(text(60)).max(12),missing:z.array(text(300)).max(15),sourceIds:z.array(text(100)).min(1).max(20)}).strict();
export const posterSchema=z.object({headline:text(80),subheading:text(160),cta:text(40)}).strict();
export const copySchema = z.object({
  title:text(120),caption:text(2200),hashtags:z.array(text(50)).max(8),
  scenes:z.array(z.object({headline:text(80),caption:text(160),sourceIds:z.array(text(100)).max(8)}).strict()).length(3),
  reviewNotes:z.array(text(500)).max(10),listing:listingSchema.optional(),poster:posterSchema.optional(),narration:text(600).optional(),videoPrompt:text(1500).optional()
}).strict();
export const contentSchema=copySchema.extend({listing:listingSchema,poster:posterSchema,narration:text(600),videoPrompt:text(1500)});
export type Copy = z.infer<typeof copySchema>;
export type StepKey = 'discover'|'sources'|'cost'|'research'|'copy'|'poster'|'speech'|'video_submit'|'video_wait'|'render'|'package';
export type Step = { key:StepKey;label:string;state:'pending'|'running'|'done'|'blocked'|'failed';attempts:number;summary:string;startedAt?:string;finishedAt?:string };
export type Asset = { id:string;workspaceId:string;productId:string;name:string;file:string;hash:string;rights:string;createdAt:string };
export type Job = { id:string;workspaceId:string;createdBy:string;requestHash:string;productId:string|null;productVersion:number|null;
  kind:'discovery'|'launch'|'render'|'content';state:'queued'|'running'|'blocked'|'paused'|'waiting_review'|'succeeded'|'cancelled';version:number;
  input:{query:string;urls:string[];product?:Product;script?:Copy;assetId?:string;budgetCents:number;voiceover?:boolean;videoMode?:'slideshow'|'minimax'};
  remoteVideo?:{taskId:string;endpoint:string;fileId?:string;status:string;submittedAt:string};nextRunAt?:string;
  steps:Step[];sources:Source[];research?:Research;copy?:Copy;cost?:unknown;
  artifacts:{name:string;file:string;mime:string;bytes:number;hash:string}[];
  error:string;lease:string|null;createdAt:string;updatedAt:string;reviewedBy?:string;
};
export const startSchema = z.object({kind:z.enum(['discovery','launch','render','content']), productId:z.string().uuid().optional(),expectedVersion:z.number().int().positive().optional(),
  query:z.string().trim().max(400).default(''),urls:z.array(z.string().url().max(2000)).max(5).default([]),
  budgetCents:z.number().int().min(0).max(10000),assetId:z.string().uuid().optional(),script:copySchema.optional(),voiceover:z.boolean().default(false),videoMode:z.enum(['slideshow','minimax']).default('slideshow')
}).strict();
export type Start = z.infer<typeof startSchema>;
export const stepLabels:Record<StepKey,string>={discover:'寻找供货来源',sources:'采集供货证据',cost:'计算成本情景',research:'AI 选择供应商与市场',copy:'生成商品内容',poster:'生成多尺寸海报',speech:'MiniMax 合成配音',video_submit:'提交海螺视频',video_wait:'等待并下载海螺视频',render:'制作最终视频',package:'整理交付素材'};
const flowErrorBrand=Symbol.for('agentsale.flow-error');
export class FlowError extends Error {
  readonly [flowErrorBrand]=true;
  constructor(public code:string,message:string,public retryable=false){super(message);}
  static is(error:unknown):error is FlowError{return error instanceof Error&&(error as unknown as Record<symbol,unknown>)[Symbol.for('agentsale.flow-error')]===true;}
}
