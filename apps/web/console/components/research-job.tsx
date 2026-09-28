'use client';
import Link from 'next/link';
import {ArrowDown,ArrowLeft,Check,Clock3,RefreshCw} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import type {Job} from '@agentsale/automation';

type FlowData={jobs:Job[]};
const stateText:Record<Job['state'],string>={queued:'等待执行',running:'正在执行',blocked:'需要信息',paused:'已暂停',waiting_review:'内部审阅',succeeded:'已完成',cancelled:'已取消'};
const toolText={"web.search":'搜索网页',"web.fetch":'读取网页'} as const;
const stripCode=(text:string)=>text.replace(/^[A-Z_]+[：:]\s*/,'');
type ActivityItem=NonNullable<Job['activity']>[number];

function legacyActivity(job:Job):ActivityItem[]{
  const items:ActivityItem[]=[{id:'created',kind:'status',title:'任务已创建',detail:'已进入执行队列。',createdAt:job.createdAt}];
  for(const step of job.steps){
    if(step.startedAt)items.push({id:`${step.key}-started`,kind:'status',title:`开始执行：${step.label}`,detail:`第 ${job.steps.indexOf(step)+1}/${job.steps.length} 个步骤`,createdAt:step.startedAt});
    if(step.finishedAt)items.push({id:`${step.key}-finished`,kind:step.state==='done'?'result':'error',title:step.state==='done'?`${step.label}已完成`:`${step.label}需要处理`,detail:stripCode(step.summary),createdAt:step.finishedAt});
  }
  for(const plan of job.researchPlans||[])items.push({id:`plan-${plan.iteration}`,kind:'thinking',title:`第 ${plan.iteration} 轮判断已形成`,detail:plan.assessment,createdAt:plan.createdAt});
  for(const run of job.toolRuns||[])items.push({id:run.id,kind:run.status==='succeeded'?'result':'error',title:`${toolText[run.tool]}${run.status==='succeeded'?'完成':'未完成'}`,detail:run.summary,createdAt:run.finishedAt});
  return items.sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)).slice(-100);
}

function elapsed(start:string|undefined,now:number){
  const seconds=Math.max(0,Math.floor((now-Date.parse(start||new Date(now).toISOString()))/1000));
  if(seconds<60)return `${seconds} 秒`;
  const minutes=Math.floor(seconds/60),rest=seconds%60;
  return `${minutes} 分 ${String(rest).padStart(2,'0')} 秒`;
}

function eventTime(value:string){return new Date(value).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});}

export function ResearchJob({jobId}:{jobId:string}){
  const [job,setJob]=useState<Job|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[now,setNow]=useState(Date.now()),[following,setFollowing]=useState(true);
  const streamRef=useRef<HTMLDivElement>(null);
  async function load(){
    try{
      const response=await fetch('/api/v1/automation',{cache:'no-store'}),body=await response.json() as FlowData&{message?:string};
      if(!response.ok)throw new Error(body.message||'无法读取任务');
      const found=body.jobs.find(item=>item.id===jobId);
      if(!found)throw new Error('任务不存在或已被清理');
      setJob(found);setError('');
    }catch(reason){setError(reason instanceof Error?reason.message:'无法读取任务');}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),3000);return()=>clearInterval(timer);},[jobId]);
  useEffect(()=>{if(job?.state!=='running')return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[job?.state]);
  const activity=job?(job.activity?.length?job.activity:legacyActivity(job)):[];
  useEffect(()=>{if(!following)return;const stream=streamRef.current;if(!stream)return;const frame=requestAnimationFrame(()=>stream.scrollTo({top:stream.scrollHeight,behavior:'smooth'}));return()=>cancelAnimationFrame(frame);},[activity.length,following,job?.state]);
  if(loading)return <main className="research-page"><p className="research-loading"><RefreshCw className="spin" size={17}/>正在读取任务证据…</p></main>;
  if(!job)return <main className="research-page"><Link className="research-back" href="/"><ArrowLeft size={15}/>返回 Agent</Link><div className="research-error" role="alert">{error}</div></main>;
  return <main className="research-page">
    <header className="research-header"><div><Link className="research-back" href="/"><ArrowLeft size={15}/>返回 Agent</Link><span>任务节点 · {job.id.slice(0,8)}</span><h1>{job.kind==='discovery'?'选品与供应商调研':'自动化执行详情'}</h1><p>{job.input.query||'依据当前经营目标自动执行'}</p></div><div className={'research-state '+job.state}><i/>{stateText[job.state]}</div></header>
    {error&&<div className="research-error" role="alert">{error}</div>}
    <section className="research-section"><div className="research-section-title"><div><span>执行层</span><h2>任务进度</h2></div><button onClick={()=>void load()} aria-label="刷新任务"><RefreshCw size={15}/>刷新</button></div><ol className="research-steps">{job.steps.map((step,index)=><li data-state={step.state} key={step.key}><div>{step.state==='done'?<Check size={14}/>:<Clock3 size={14}/>}</div><span>步骤 {String(index+1).padStart(2,'0')}</span><h3>{step.label}</h3><p>{stripCode(step.summary)||({pending:'等待前序步骤',running:'正在执行',done:'已完成',blocked:'需要补充信息',failed:'执行失败'}[step.state])}</p></li>)}</ol></section>
    <section className="research-section research-live"><div className="research-section-title"><div><span>实时反馈</span><h2>Agent 运行动态</h2></div><div className="research-live-actions"><small>{job.state==='running'?'每 3 秒自动更新':'执行记录已保存'}</small>{!following&&<button onClick={()=>{setFollowing(true);streamRef.current?.scrollTo({top:streamRef.current.scrollHeight,behavior:'smooth'});}}><ArrowDown size={14}/>回到最新</button>}</div></div>
      <div className="research-live-stream" ref={streamRef} role="log" aria-live="polite" aria-relevant="additions" onScroll={event=>{const target=event.currentTarget;setFollowing(target.scrollHeight-target.clientHeight-target.scrollTop<28);}}>
        {activity.map(item=><article className="research-live-item" data-kind={item.kind} key={item.id}><time dateTime={item.createdAt}>{eventTime(item.createdAt)}</time><i/><div><b>{item.title}</b><p>{item.detail}</p></div></article>)}
        {job.state==='running'&&<article className="research-live-item active" data-kind="active"><time>{eventTime(new Date(now).toISOString())}</time><i/><div><b>{job.steps.find(step=>step.state==='running')?.label||'Agent 正在处理任务'}<span className="research-typing" aria-hidden="true"><em/><em/><em/></span></b><p>正在等待当前模型或工具返回，已持续 {elapsed(job.steps.find(step=>step.state==='running')?.startedAt,now)}。页面会自动同步真实执行结果。</p></div></article>}
      </div>
      <p className="research-live-note">向上滚动可暂停自动跟随；新的执行事件仍会继续保存。</p>
    </section>
    <section className="research-section"><div className="research-section-title"><div><span>决策层</span><h2>Agent 调研轨迹</h2></div><small>{job.toolRuns?.length||0} 次工具调用</small></div>
      {job.researchPlans?.length?job.researchPlans.map(plan=><article className="research-plan" key={plan.iteration}><span>第 {plan.iteration} 轮判断</span><p>{plan.assessment}</p>{plan.complete&&<b>证据收集结束</b>}</article>):<p className="research-empty">尚未形成调研计划。</p>}
      {job.toolRuns?.length?<div className="research-tools">{job.toolRuns.map(run=><details key={run.id}><summary><span>{toolText[run.tool]}</span><b data-status={run.status}>{run.status==='succeeded'?'完成':run.status==='rejected'?'已拒绝':'失败'}</b></summary><p className="research-target">{run.input.query||run.input.url}</p><dl><div><dt>选择原因</dt><dd>{run.reason}</dd></div><div><dt>执行结果</dt><dd>{run.summary}</dd></div></dl></details>)}</div>:<p className="research-empty">Agent 没有执行网页工具。</p>}
      {job.researchGaps?.length?<div className="research-gaps"><b>仍缺少的证据</b><ul>{job.researchGaps.map((gap,index)=><li key={index}>{gap}</li>)}</ul></div>:null}
    </section>
    {job.research&&<section className="research-section"><div className="research-section-title"><div><span>结论</span><h2>供货与市场判断</h2></div></div><p className="research-summary">{job.research.summary}</p><div className="research-verdict">{job.research.selectedIndex===null?'暂未找到证据完整、可进入测试的供货方案':`建议继续核实：${job.research.candidates[job.research.selectedIndex]?.name} → ${job.research.market}`}</div>{job.research.candidates.length>0&&<div className="research-candidates">{job.research.candidates.map((candidate,index)=><details key={index} open={index===job.research?.selectedIndex}><summary>{candidate.name} · {candidate.product}</summary><p>大陆供货：{candidate.mainlandEvidence?.quote||'缺少证据'}</p><p>单件代发：{candidate.dropshipEvidence?.quote||'缺少证据'}</p>{candidate.markets.map((market,marketIndex)=><p key={marketIndex}>{market.country}：{market.shippingEvidence.quote}</p>)}</details>)}</div>}<p className="research-reasoning">{job.research.reasoning}</p></section>}
    {job.sources.length>0&&<section className="research-section"><div className="research-section-title"><div><span>证据层</span><h2>来源与采集记录</h2></div><small>{job.sources.length} 个来源</small></div><div className="research-sources">{job.sources.map((source,index)=><details key={source.id+index}><summary><span>{source.title}</span><b>{source.status==='fetched'?'已采集':source.status==='imported'?'已有资料':'不可访问'}</b></summary><p>{source.error||source.text.slice(0,1800)}</p><a href={source.url} target="_blank" rel="noreferrer">打开原始来源</a><small>{new Date(source.fetchedAt).toLocaleString('zh-CN')} · {source.hash.slice(0,16)}</small></details>)}</div></section>}
    {job.error&&<div className="research-error" role="alert">{stripCode(job.error)}</div>}
  </main>;
}
