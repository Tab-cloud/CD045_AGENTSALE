import {z} from 'zod';
import {FlowError} from './types';
import type {CommerceOrder,CommerceRecord,ConnectorStatus} from './connectors';

export const agentIntentSchema=z.object({
  action:z.enum(['chat','status','set_goal','set_budget','set_interval','start','pause','run','sync','discover','content']),
  value:z.string().max(1000).default(''), explanation:z.string().max(600).default('')
}).strict();
export type AgentIntent=z.infer<typeof agentIntentSchema>|{action:'help';value:string;explanation:string};
export type CommerceAgentState={
  status:'idle'|'active'|'paused'|'blocked';mode:'autonomous';objective:string;cycleBudgetCents:number;cycleIntervalSeconds:number;
  owner:{id:string;username:string}|null;lastAction:string;lastError:string;lastCycleAt?:string;nextCycleAt?:string;version:number;updatedAt:string;
};
export type CommerceAgentMessage={id:string;role:'user'|'assistant'|'system';kind:string;content:string;payload:unknown;createdAt:string};
export type CommerceAgentSnapshot={state:CommerceAgentState;messages:CommerceAgentMessage[];capabilities:{model:boolean;search:boolean;marketConnector:boolean;publishingConnector:boolean;orderConnector:boolean;supplierConnector:boolean;assetConnector:boolean;logisticsConnector:boolean;customerConnector:boolean};connectors:ConnectorStatus[];orders:CommerceOrder[];records:CommerceRecord[];jobs:{id:string;state:string;kind:string;createdAt:string}[]};

export const agentHelp=`可用命令：
/status 查看 Agent 状态与阻塞项
/goal <目标> 设置经营目标，例如“寻找可从中国单件代发到美国的轻小家居产品”
/budget <美元> 设置每个自动周期的模型与搜索预留上限
/interval <分钟> 设置自动周期，范围 1–1440 分钟
/start 启动持续运行
/pause 暂停持续运行
/run 立即执行一个决策周期
/sync 立即同步已授权渠道的市场、订单、财务与售后状态
/discover [方向] 启动一次供应商与市场发现
/content <SKU> 根据已有商品资料自动生成内容
/config 查看服务配置入口
/help 查看命令。也可以直接用自然语言描述目标或要求。`;

export function parseAgentSlash(message:string):AgentIntent|null{
  const text=message.trim();if(!text.startsWith('/'))return null;const [raw,...parts]=text.slice(1).split(/\s+/),value=parts.join(' ').trim(),command=raw.toLowerCase();
  const map:Record<string,AgentIntent['action']>={help:'help',status:'status',goal:'set_goal',budget:'set_budget',interval:'set_interval',start:'start',pause:'pause',run:'run',sync:'sync',discover:'discover',content:'content',config:'status'};
  const action=map[command];if(!action)throw new FlowError('AGENT_COMMAND_UNKNOWN',`未知命令 /${command}。输入 /help 查看命令。`);
  if(['set_goal','set_budget','set_interval','content'].includes(action)&&!value)throw new FlowError('AGENT_COMMAND_VALUE',`/${command} 需要参数`);
  return {action,value,explanation:command==='config'?'show_config':''};
}

export function inferAgentIntent(message:string):AgentIntent|null{
  const text=message.trim();
  if(/(暂停|停下|停止运行)/.test(text))return {action:'pause',value:'',explanation:'明确暂停请求'};
  if(/(立即运行|执行一轮|现在执行)/.test(text))return {action:'run',value:'',explanation:'明确执行请求'};
  if(/(同步|拉取).*(订单|渠道|店铺)/.test(text))return {action:'sync',value:'',explanation:'同步渠道数据'};
  if(/(开始|启动).*(自动|运行|agent)/i.test(text))return {action:'start',value:'',explanation:'明确启动请求'};
  if(/(状态|进度|在做什么|做了什么)/.test(text))return {action:'status',value:'',explanation:'状态查询'};
  if(/(寻找|查找|调研|选品|供应商)/.test(text))return {action:'discover',value:text,explanation:'商品与供应商发现'};
  const goal=text.match(/(?:目标|任务)(?:是|为|：|:)?\s*(.+)/);if(goal?.[1])return {action:'set_goal',value:goal[1],explanation:'经营目标'};
  return null;
}
