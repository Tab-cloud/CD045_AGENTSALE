import {z} from 'zod';

const text=(max:number)=>z.string().trim().min(1).max(max);
export const audioSchema=z.object({
  baseUrl:z.enum(['https://api.minimax.cn/v1','https://api.minimaxi.com/v1','https://api.minimax.io/v1']),
  speechModel:text(100),voiceId:text(100),enabled:z.boolean()
}).strict();
export const settingsSchema=z.object({
  baseUrl:z.string().url().max(500),model:text(100),localModel:z.boolean(),
  format:z.enum(['json_schema','json_object','prompt_json']),
  protocol:z.enum(['openai','minimax']),minimax:audioSchema
}).strict();
export type Settings=z.infer<typeof settingsSchema>;
export type SecretSettings=Settings&{apiKey:string;minimaxKey:string;verifiedAt:string|null;revision:string};
export type PublicSettings=Settings&{hasApiKey:boolean;hasMinimaxKey:boolean;verifiedAt:string|null;revision:string};
export const defaults:Settings={baseUrl:'https://api.openai.com/v1',model:'',localModel:false,format:'json_schema',protocol:'openai',minimax:{baseUrl:'https://api.minimax.cn/v1',speechModel:'speech-2.8-hd',voiceId:'English_Trustworthy_Man',enabled:false}};
export type User={id:string;username:string;role:'admin'|'operator';enabled:boolean;phone?:string|null;wechatBound?:boolean};
const flowErrorBrand=Symbol.for('agentsale.flow-error');
export class FlowError extends Error{
  readonly [flowErrorBrand]=true;
  constructor(public code:string,message:string,public retryable=false){super(message);}
  static is(error:unknown):error is FlowError{return error instanceof Error&&(error as unknown as Record<symbol,unknown>)[Symbol.for('agentsale.flow-error')]===true;}
}
