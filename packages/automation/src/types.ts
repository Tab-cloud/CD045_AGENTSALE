import {z} from 'zod';

const text=(max:number)=>z.string().trim().min(1).max(max);
export const minimaxVideoModelSchema=z.enum(['MiniMax-Hailuo-2.3','MiniMax-Hailuo-02','T2V-01-Director','T2V-01','MiniMax-H3','MiniMax-H3-Max']);
export const audioSchema=z.object({
  baseUrl:z.enum(['https://api.minimax.cn/v1','https://api.minimaxi.com/v1','https://api.minimax.io/v1']),
  speechModel:text(100),voices:z.array(z.object({id:text(100),name:text(100)}).strict()).min(1),enabled:z.boolean(),
  aggregate:z.boolean(),textModel:text(100),planType:z.enum(['unspecified','plus','max','ultra','payg']),imageModel:text(100),videoModel:minimaxVideoModelSchema,videoEnabled:z.boolean()
}).strict();
export const routingSchema=z.object({
  'text.generate':z.array(z.enum(['standard','minimax'])).length(2).refine(v=>new Set(v).size===2),
  'image.generate':z.array(z.enum(['standard','minimax'])).length(2).refine(v=>new Set(v).size===2),
  'image.edit':z.array(z.literal('standard')).length(1),
  'video.generate':z.array(z.enum(['standard','minimax'])).length(2).refine(v=>new Set(v).size===2),
  'audio.speech':z.array(z.enum(['standard','minimax'])).length(2).refine(v=>new Set(v).size===2),
}).strict();
export type Routing=z.infer<typeof routingSchema>;
export const settingsSchema=z.object({
  baseUrl:z.string().url().max(500),model:z.string().trim().max(100),localModel:z.boolean(),
  format:z.enum(['json_schema','json_object','prompt_json']),
  protocol:z.enum(['openai','minimax']),independentAudioEnabled:z.boolean(),independentAudioBaseUrl:z.enum(['https://api.minimax.cn/v1','https://api.minimaxi.com/v1','https://api.minimax.io/v1']),routing:routingSchema,minimax:audioSchema
}).strict();
export type Settings=z.infer<typeof settingsSchema>;
export function minimaxVideoAllowed(planType:Settings['minimax']['planType'],videoModel:Settings['minimax']['videoModel']){
  return planType==='payg'||(planType==='max'||planType==='ultra')&&videoModel==='MiniMax-Hailuo-2.3';
}
export type SecretSettings=Settings&{apiKey:string;minimaxKey:string;aggregateKey:string;verifiedAt:string|null;revision:string};
export type PublicSettings=Settings&{hasApiKey:boolean;hasMinimaxKey:boolean;hasAggregateKey:boolean;verifiedAt:string|null;revision:string};
export const defaults:Settings={baseUrl:'https://api.openai.com/v1',model:'',localModel:false,format:'json_schema',protocol:'openai',independentAudioEnabled:false,independentAudioBaseUrl:'https://api.minimax.cn/v1',routing:{'text.generate':['standard','minimax'],'image.generate':['standard','minimax'],'image.edit':['standard'],'video.generate':['standard','minimax'],'audio.speech':['standard','minimax']},minimax:{baseUrl:'https://api.minimax.cn/v1',speechModel:'speech-2.8-hd',voices:[{id:'Chinese (Mandarin)_Reliable_Executive',name:'中文稳重'},{id:'English_Trustworthy_Man',name:'English trustworthy'}],enabled:false,aggregate:false,textModel:'MiniMax-M3',planType:'unspecified',imageModel:'image-01',videoModel:'MiniMax-Hailuo-2.3',videoEnabled:false}};
export type User={id:string;username:string;role:'admin'|'operator';enabled:boolean;phone?:string|null;wechatBound?:boolean};
const flowErrorBrand=Symbol.for('agentsale.flow-error');
export class FlowError extends Error{
  readonly [flowErrorBrand]=true;
  constructor(public code:string,message:string,public retryable=false){super(message);}
  static is(error:unknown):error is FlowError{return error instanceof Error&&(error as unknown as Record<symbol,unknown>)[Symbol.for('agentsale.flow-error')]===true;}
}
// These HTTP responses explicitly reject a request before provider execution.
// Timeouts and generic server failures remain uncertain and must not fail over.
export function providerRejectedBeforeExecution(status:number){
  return [400,401,402,403,404,422,429].includes(status);
}
