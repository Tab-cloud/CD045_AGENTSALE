import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { modelJson } from './providers';
import { FlowError,type ResearchPlanTrace,type ResearchToolName,type ResearchToolRun,type SecretSettings,type Source,type WebSearchHit } from './types';

const searchInputSchema=z.object({query:z.string().trim().min(3).max(400)}).strict();
const fetchInputSchema=z.object({url:z.string().url().max(2000)}).strict();
const researchActionSchema=z.object({
  tool:z.enum(['web.search','web.fetch']),
  query:z.string().max(400).default(''),
  url:z.string().max(2000).default(''),
  reason:z.string().min(1).max(300)
}).strict();

export const researchPlanSchema=z.object({
  assessment:z.string().min(1).max(1000),
  actions:z.array(researchActionSchema).max(4),
  complete:z.boolean(),
  gaps:z.array(z.string().min(1).max(300)).max(8)
}).strict();

type ToolDefinition={description:string;input:z.ZodType;execute:(input:any)=>Promise<unknown>};
export class ToolRegistry {
  private readonly definitions=new Map<ResearchToolName,ToolDefinition>();
  register(name:ResearchToolName,definition:ToolDefinition){if(this.definitions.has(name))throw new Error(`Tool already registered: ${name}`);this.definitions.set(name,definition);return this;}
  catalog(){return [...this.definitions].map(([name,definition])=>({name,description:definition.description,inputSchema:z.toJSONSchema(definition.input)}));}
  async call(name:ResearchToolName,input:unknown){const definition=this.definitions.get(name);if(!definition)throw new FlowError('TOOL_UNKNOWN',`未注册工具 ${name}`);return definition.execute(definition.input.parse(input));}
}

export function createResearchToolRegistry(services:{search?:((query:string)=>Promise<WebSearchHit[]>);fetch:(url:string)=>Promise<Source>}){
  const registry=new ToolRegistry();
  if(services.search)registry.register('web.search',{description:'搜索公开网页，返回标题、摘要和可继续抓取的 URL。',input:searchInputSchema,execute:({query})=>services.search!(query)});
  return registry.register('web.fetch',{description:'抓取一个已由搜索发现或用户提供的公开 HTML URL，返回清理后的正文证据。',input:fetchInputSchema,execute:({url})=>services.fetch(url)});
}

export type ResearchLoopState={
  objective:string;iteration:number;maxIterations:number;
  searchAvailable:boolean;
  candidateUrls:string[];
  searchResults:WebSearchHit[];
  sources:{id:string;url:string;title:string;excerpt:string}[];
  previousRuns:{tool:ResearchToolName;status:ResearchToolRun['status'];summary:string}[];
};

export async function planResearch(settings:SecretSettings,state:ResearchLoopState,catalog:ReturnType<ToolRegistry['catalog']>){
  return modelJson(settings,researchPlanSchema,'research_tool_plan',`你是自动化电商调研 Agent 的计划器。目标是从中国大陆可供货的供应商出发，找到支持单件代发并能配送到明确海外国家的轻小商品证据。你只能请求“可用工具”目录中实际列出的工具，不得声称工具已经执行；searchAvailable 为 false 时不得请求 web.search。先搜索，再抓取搜索结果或用户提供的 URL；发现缺少大陆主体、单件代发、具体国家配送、产品或采购条件证据时，应改写查询继续寻找。不要抓取登录页、账户页、内网地址，不要尝试绕过平台限制。complete 只有在已有来源足以交给证据审查模型时才为 true。每轮最多请求 4 个动作；web.search 填 query 并把 url 留空，web.fetch 填 url 并把 query 留空。\n可用工具：${JSON.stringify(catalog)}\n当前研究状态：${JSON.stringify(state)}`);
}

const canonical=(raw:string)=>{try{return new URL(raw).href;}catch{return raw;}};
const messageOf=(error:unknown)=>error instanceof z.ZodError?'工具参数未通过结构校验':error instanceof Error?error.message:'工具执行失败';

export async function runWebResearch(input:{
  objective:string;
  seedUrls:string[];
  searchAvailable:boolean;
  plan:(state:ResearchLoopState,catalog:ReturnType<ToolRegistry['catalog']>)=>Promise<z.infer<typeof researchPlanSchema>>;
  search:(query:string)=>Promise<WebSearchHit[]>;
  fetch:(url:string)=>Promise<Source>;
}){
  const maxIterations=3,maxSearches=3,maxFetches=8;
  const registry=createResearchToolRegistry({search:input.searchAvailable?input.search:undefined,fetch:input.fetch}),catalog=registry.catalog();
  const knownUrls=new Set(input.seedUrls.map(canonical)),searched=new Set<string>(),fetched=new Set<string>();
  const searchResults:WebSearchHit[]=[],sources:Source[]=[],toolRuns:ResearchToolRun[]=[],researchPlans:ResearchPlanTrace[]=[];
  let gaps:string[]=[];

  const record=(iteration:number,tool:ResearchToolName,status:ResearchToolRun['status'],toolInput:ResearchToolRun['input'],reason:string,summary:string,startedAt:string)=>toolRuns.push({id:randomUUID(),iteration,tool,status,input:toolInput,reason,summary,startedAt,finishedAt:new Date().toISOString()});
  for(let iteration=1;iteration<=maxIterations;iteration++){
    const state:ResearchLoopState={objective:input.objective,iteration,maxIterations,searchAvailable:input.searchAvailable,candidateUrls:[...knownUrls].filter(url=>!fetched.has(url)).slice(0,18),searchResults:searchResults.slice(-18),sources:sources.map(source=>({id:source.id,url:source.url,title:source.title,excerpt:source.text.slice(0,1500)})),previousRuns:toolRuns.map(run=>({tool:run.tool,status:run.status,summary:run.summary}))};
    const plan=await input.plan(state,catalog);gaps=plan.gaps;researchPlans.push({iteration,assessment:plan.assessment,complete:plan.complete,gaps:plan.gaps,createdAt:new Date().toISOString()});
    if(plan.complete&&sources.length)break;
    let executed=0;

    for(const action of plan.actions){
      const startedAt=new Date().toISOString();
      if(action.tool==='web.search'){
        const query=action.query.trim(),toolInput={query};
        if(!input.searchAvailable){record(iteration,action.tool,'rejected',toolInput,action.reason,'搜索服务尚未配置',startedAt);continue;}
        if(!query||searched.has(query.toLocaleLowerCase())||searched.size>=maxSearches){record(iteration,action.tool,'rejected',toolInput,action.reason,'查询为空、重复或已达到搜索上限',startedAt);continue;}
        searched.add(query.toLocaleLowerCase());
        try{const hits=await registry.call('web.search',{query}) as WebSearchHit[];for(const hit of hits){const url=canonical(hit.url);knownUrls.add(url);if(!searchResults.some(item=>canonical(item.url)===url))searchResults.push({...hit,url});}record(iteration,action.tool,'succeeded',toolInput,action.reason,`找到 ${hits.length} 条公开网页结果`,startedAt);executed++;}
        catch(error){record(iteration,action.tool,'failed',toolInput,action.reason,messageOf(error),startedAt);}
        continue;
      }

      const url=canonical(action.url),toolInput={url};
      if(!knownUrls.has(url)){record(iteration,action.tool,'rejected',toolInput,action.reason,'只能抓取搜索发现或用户提供的 URL',startedAt);continue;}
      if(fetched.has(url)||fetched.size>=maxFetches){record(iteration,action.tool,'rejected',toolInput,action.reason,'URL 已抓取或已达到抓取上限',startedAt);continue;}
      fetched.add(url);
      try{const source=await registry.call('web.fetch',{url}) as Source;if(!sources.some(item=>item.hash===source.hash||item.url===source.url))sources.push(source);record(iteration,action.tool,'succeeded',toolInput,action.reason,`已保存来源“${source.title}”及内容哈希`,startedAt);executed++;}
      catch(error){record(iteration,action.tool,'failed',toolInput,action.reason,messageOf(error),startedAt);}
    }

    if(!executed&&plan.actions.length===0)break;
  }

  return {urls:[...knownUrls].slice(0,maxFetches),sources,toolRuns,researchPlans,gaps};
}
