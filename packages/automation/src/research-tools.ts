import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { modelJson } from './providers';
import { FlowError,type JobActivity,type ResearchPlanTrace,type ResearchToolName,type ResearchToolRun,type SecretSettings,type Source,type WebSearchHit } from './types';

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
  onProgress?:(event:Omit<JobActivity,'id'|'createdAt'>)=>Promise<void>;
}){
  const maxIterations=3,maxSearches=3,maxFetches=8;
  const registry=createResearchToolRegistry({search:input.searchAvailable?input.search:undefined,fetch:input.fetch}),catalog=registry.catalog();
  const knownUrls=new Set(input.seedUrls.map(canonical)),searched=new Set<string>(),fetched=new Set<string>();
  const searchResults:WebSearchHit[]=[],sources:Source[]=[],toolRuns:ResearchToolRun[]=[],researchPlans:ResearchPlanTrace[]=[];
  let gaps:string[]=[];

  const notify=(event:Omit<JobActivity,'id'|'createdAt'>)=>input.onProgress?.(event)??Promise.resolve();
  const record=async(iteration:number,tool:ResearchToolName,status:ResearchToolRun['status'],toolInput:ResearchToolRun['input'],reason:string,summary:string,startedAt:string)=>{
    toolRuns.push({id:randomUUID(),iteration,tool,status,input:toolInput,reason,summary,startedAt,finishedAt:new Date().toISOString()});
    await notify({kind:status==='succeeded'?'result':'error',title:`${tool==='web.search'?'网页搜索':'网页读取'}${status==='succeeded'?'完成':status==='rejected'?'未执行':'失败'}`,detail:summary});
  };
  for(let iteration=1;iteration<=maxIterations;iteration++){
    const state:ResearchLoopState={objective:input.objective,iteration,maxIterations,searchAvailable:input.searchAvailable,candidateUrls:[...knownUrls].filter(url=>!fetched.has(url)).slice(0,18),searchResults:searchResults.slice(-18),sources:sources.map(source=>({id:source.id,url:source.url,title:source.title,excerpt:source.text.slice(0,1500)})),previousRuns:toolRuns.map(run=>({tool:run.tool,status:run.status,summary:run.summary}))};
    await notify({kind:'thinking',title:`正在规划第 ${iteration} 轮调研`,detail:'AI 正在结合已有来源、工具结果和证据缺口决定下一步。'});
    const plan=await input.plan(state,catalog);gaps=plan.gaps;researchPlans.push({iteration,assessment:plan.assessment,complete:plan.complete,gaps:plan.gaps,createdAt:new Date().toISOString()});
    await notify({kind:'thinking',title:`第 ${iteration} 轮判断已形成`,detail:plan.assessment});
    if(plan.complete&&sources.length)break;
    let executed=0;

    for(const action of plan.actions){
      const startedAt=new Date().toISOString();
      if(action.tool==='web.search'){
        const query=action.query.trim(),toolInput={query};
        if(!input.searchAvailable){await record(iteration,action.tool,'rejected',toolInput,action.reason,'搜索服务尚未配置',startedAt);continue;}
        if(!query||searched.has(query.toLocaleLowerCase())||searched.size>=maxSearches){await record(iteration,action.tool,'rejected',toolInput,action.reason,'查询为空、重复或已达到搜索上限',startedAt);continue;}
        searched.add(query.toLocaleLowerCase());
        await notify({kind:'tool',title:'正在搜索公开网页',detail:query});
        try{const hits=await registry.call('web.search',{query}) as WebSearchHit[];for(const hit of hits){const url=canonical(hit.url);knownUrls.add(url);if(!searchResults.some(item=>canonical(item.url)===url))searchResults.push({...hit,url});}await record(iteration,action.tool,'succeeded',toolInput,action.reason,`找到 ${hits.length} 条公开网页结果`,startedAt);executed++;}
        catch(error){await record(iteration,action.tool,'failed',toolInput,action.reason,messageOf(error),startedAt);}
        continue;
      }

      const url=canonical(action.url),toolInput={url};
      if(!knownUrls.has(url)){await record(iteration,action.tool,'rejected',toolInput,action.reason,'只能抓取搜索发现或用户提供的 URL',startedAt);continue;}
      if(fetched.has(url)||fetched.size>=maxFetches){await record(iteration,action.tool,'rejected',toolInput,action.reason,'URL 已抓取或已达到抓取上限',startedAt);continue;}
      fetched.add(url);
      await notify({kind:'tool',title:'正在读取网页证据',detail:url});
      try{const source=await registry.call('web.fetch',{url}) as Source;if(!sources.some(item=>item.hash===source.hash||item.url===source.url))sources.push(source);await record(iteration,action.tool,'succeeded',toolInput,action.reason,`已保存来源“${source.title}”及内容哈希`,startedAt);executed++;}
      catch(error){await record(iteration,action.tool,'failed',toolInput,action.reason,messageOf(error),startedAt);}
    }

    // The planner chooses the direction; the executor guarantees forward
    // progress. Some models keep asking for more searches after URLs exist.
    // Fetch a small bounded sample so a valid search can never end with zero
    // evidence solely because of a poor tool plan.
    if(sources.length<2&&fetched.size<maxFetches){
      for(const url of [...knownUrls].filter(candidate=>!fetched.has(candidate)).slice(0,2)){
        const startedAt=new Date().toISOString();fetched.add(url);
        await notify({kind:'tool',title:'正在补充读取候选来源',detail:url});
        try{const source=await registry.call('web.fetch',{url}) as Source;if(!sources.some(item=>item.hash===source.hash||item.url===source.url))sources.push(source);await record(iteration,'web.fetch','succeeded',{url},'执行器自动读取搜索候选，防止计划停滞',`已保存来源“${source.title}”及内容哈希`,startedAt);executed++;}
        catch(error){await record(iteration,'web.fetch','failed',{url},'执行器自动读取搜索候选，防止计划停滞',messageOf(error),startedAt);}
      }
    }

    if(!executed&&plan.actions.length===0)break;
  }

  return {urls:[...knownUrls].slice(0,maxFetches),sources,toolRuns,researchPlans,gaps};
}

export async function runPublicMarketSearch(input:{
  objective:string;
  search:(query:string)=>Promise<WebSearchHit[]>;
  fetch:(url:string)=>Promise<Source>;
  onProgress?:(event:Omit<JobActivity,'id'|'createdAt'>)=>Promise<void>;
}){
  const country=input.objective.includes('美国')?'United States':input.objective.includes('德国')?'Germany':input.objective.includes('英国')?'United Kingdom':input.objective.includes('法国')?'France':'overseas market';
  const topic=input.objective.replace(/寻找|适合|市场|支持|中国大陆|中国|供应商|单件代发|海外测试|的|、|，/g,' ').replace(/轻小商品/g,'small lightweight products').replace(/\s+/g,' ').trim()||'small lightweight products';
  const queries=[
    `${topic} ${country} ecommerce price reviews competitors Amazon TikTok Shop Temu`,
    `${topic} ${country} market trend demand shipping delivery public data`
  ],toolRuns:ResearchToolRun[]=[],sources:Source[]=[],candidates:WebSearchHit[]=[];
  const notify=(event:Omit<JobActivity,'id'|'createdAt'>)=>input.onProgress?.(event)??Promise.resolve();
  for(let index=0;index<queries.length;index++){
    const query=queries[index],startedAt=new Date().toISOString();
    await notify({kind:'tool',title:'正在检索公开市场信息',detail:query});
    try{
      const hits=await input.search(query);
      for(const hit of hits)if(!candidates.some(item=>canonical(item.url)===canonical(hit.url)))candidates.push(hit);
      const finishedAt=new Date().toISOString();
      toolRuns.push({id:randomUUID(),iteration:index+1,tool:'web.search',status:'succeeded',input:{query},reason:'自动补充公开市场、价格、竞争与履约线索',summary:`找到 ${hits.length} 条公开市场搜索结果`,startedAt,finishedAt});
      await notify({kind:'result',title:'公开市场搜索完成',detail:`第 ${index+1} 组查询找到 ${hits.length} 条结果。`});
    }catch(error){
      const finishedAt=new Date().toISOString(),summary=messageOf(error);
      toolRuns.push({id:randomUUID(),iteration:index+1,tool:'web.search',status:'failed',input:{query},reason:'自动补充公开市场、价格、竞争与履约线索',summary,startedAt,finishedAt});
      await notify({kind:'error',title:'公开市场搜索未完成',detail:summary});
    }
  }
  const blocked=/baike\.baidu|zhidao\.baidu|wikipedia|wikiwand|dictionary|hanyuguoxue|(^|\.)gov\.cn$|chinadaily/i,relevant=/price|review|rating|seller|product|market|trend|demand|shipping|delivery|amazon|tiktok|temu|销量|价格|评价|竞品|趋势|需求|运费|配送/i;
  const ranked=candidates.filter(hit=>{const host=new URL(hit.url).hostname;return !blocked.test(host)&&relevant.test(`${hit.title} ${hit.description} ${hit.url}`);});
  for(const hit of ranked.slice(0,4)){
    const url=canonical(hit.url),startedAt=new Date().toISOString();
    await notify({kind:'tool',title:'正在读取公开市场来源',detail:url});
    try{
      const source={...await input.fetch(url),category:'market' as const};
      if(!sources.some(item=>item.hash===source.hash||item.url===source.url))sources.push(source);
      const finishedAt=new Date().toISOString();
      toolRuns.push({id:randomUUID(),iteration:queries.length,tool:'web.fetch',status:'succeeded',input:{url},reason:'保存公开市场页面原文，供后续证据审查',summary:`已保存来源“${source.title}”及内容哈希`,startedAt,finishedAt});
      await notify({kind:'result',title:'公开市场来源已保存',detail:source.title});
    }catch(error){
      const finishedAt=new Date().toISOString(),summary=messageOf(error);
      toolRuns.push({id:randomUUID(),iteration:queries.length,tool:'web.fetch',status:'failed',input:{url},reason:'保存公开市场页面原文，供后续证据审查',summary,startedAt,finishedAt});
      await notify({kind:'error',title:'公开市场来源读取失败',detail:summary});
    }
  }
  await notify({kind:'thinking',title:'公开市场检索已整理',detail:sources.length?`已保存 ${sources.length} 个无需账号授权的公开来源；量化指标只在原文可核验时使用。`:'本轮未取得可读取的公开市场页面，将保留缺口并继续供应商审查。'});
  return {queries,sources,toolRuns};
}
