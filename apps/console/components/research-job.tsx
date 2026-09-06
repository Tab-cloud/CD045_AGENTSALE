'use client';
import Link from 'next/link';
import {ArrowLeft,Check,Clock3,RefreshCw} from 'lucide-react';
import {useEffect,useState} from 'react';
import type {Job} from '@agentsale/automation';

type FlowData={jobs:Job[]};
const stateText:Record<Job['state'],string>={queued:'等待执行',running:'正在执行',blocked:'需要信息',paused:'已暂停',waiting_review:'内部审阅',succeeded:'已完成',cancelled:'已取消'};
const toolText={"web.search":'搜索网页',"web.fetch":'读取网页'} as const;
const stripCode=(text:string)=>text.replace(/^[A-Z_]+[：:]\s*/,'');

export function ResearchJob({jobId}:{jobId:string}){
  const [job,setJob]=useState<Job|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
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
  if(loading)return <main className="research-page"><p className="research-loading"><RefreshCw className="spin" size={17}/>正在读取任务证据…</p></main>;
  if(!job)return <main className="research-page"><Link className="research-back" href="/"><ArrowLeft size={15}/>返回 Agent</Link><div className="research-error" role="alert">{error}</div></main>;
  return <main className="research-page">
    <header className="research-header"><div><Link className="research-back" href="/"><ArrowLeft size={15}/>返回 Agent</Link><span>任务节点 · {job.id.slice(0,8)}</span><h1>{job.kind==='discovery'?'选品与供应商调研':'自动化执行详情'}</h1><p>{job.input.query||'依据当前经营目标自动执行'}</p></div><div className={'research-state '+job.state}><i/>{stateText[job.state]}</div></header>
    {error&&<div className="research-error" role="alert">{error}</div>}
    <section className="research-section"><div className="research-section-title"><div><span>执行层</span><h2>任务进度</h2></div><button onClick={()=>void load()} aria-label="刷新任务"><RefreshCw size={15}/>刷新</button></div><ol className="research-steps">{job.steps.map((step,index)=><li data-state={step.state} key={step.key}><div>{step.state==='done'?<Check size={14}/>:<Clock3 size={14}/>}</div><span>步骤 {String(index+1).padStart(2,'0')}</span><h3>{step.label}</h3><p>{stripCode(step.summary)||({pending:'等待前序步骤',running:'正在执行',done:'已完成',blocked:'需要补充信息',failed:'执行失败'}[step.state])}</p></li>)}</ol></section>
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
