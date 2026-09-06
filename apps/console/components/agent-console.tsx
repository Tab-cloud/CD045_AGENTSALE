'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {ArrowUp,Check,Clock3,Pause,Play,RefreshCw,Settings2,Sparkles} from 'lucide-react';
import type {CommerceAgentSnapshot} from '@agentsale/automation';
import {QuickSettings} from './quick-settings';

const stateText={idle:'等待目标',active:'自动运行',paused:'已暂停',blocked:'需要处理'} as const;
const jobText:Record<string,string>={discovery:'选品与供应商调研',launch:'商品启动准备',render:'海报与视频制作',content:'商品内容生成'};
const jobState:Record<string,string>={queued:'等待执行',running:'执行中',blocked:'需要信息',paused:'已暂停',waiting_review:'内部审阅',succeeded:'已完成',cancelled:'已取消'};
const prompts=['寻找适合美国市场、支持中国单件代发的轻小商品','查看当前进度','同步店铺订单和售后','/help'];
export function AgentConsole(){
  const [data,setData]=useState<CommerceAgentSnapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[settingsOpen,setSettingsOpen]=useState(false);
  const messageList=useRef<HTMLDivElement>(null);
  async function load(){const response=await fetch('/api/v1/agent',{cache:'no-store'}),body=await response.json();if(!response.ok)throw new Error(body.message||'无法读取 Agent');setData(body);setError('');}
  useEffect(()=>{const refresh=()=>void load().catch(e=>setError(e.message));refresh();const timer=setInterval(refresh,3000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{const frame=requestAnimationFrame(()=>{if(messageList.current)messageList.current.scrollTop=messageList.current.scrollHeight;});return()=>cancelAnimationFrame(frame);},[data?.messages.length]);
  async function send(text=message){if(!text.trim()||busy)return;setBusy(true);setError('');setMessage('');try{const response=await fetch('/api/v1/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text.trim()})}),body=await response.json();if(!response.ok)throw new Error(body.message||'Agent 未完成操作');setData(body.snapshot);}catch(e){setError(e instanceof Error?e.message:'Agent 未完成操作');}finally{setBusy(false);}}
  function submit(event:FormEvent){event.preventDefault();void send();}
  const state=data?.state,jobs=data?.jobs||[],completed=jobs.filter(job=>job.state==='succeeded').length;
  return <main className="workbench">
    <header className="workbench-header"><div><span className="workbench-brand">AgentSale</span><span className="workbench-subtitle">Autonomous commerce agent</span></div><div className="workbench-actions"><span className={'workbench-state '+(state?.status||'idle')}><i/>{state?stateText[state.status]:'连接中'}</span><button onClick={()=>setSettingsOpen(true)} aria-label="打开服务配置"><Settings2 size={17}/>配置</button></div></header>
    <div className="workbench-grid">
      <section className="conversation" aria-label="Agent 对话">
        <div className="conversation-heading"><span>当前目标</span><h1>{state?.objective||'告诉我想经营什么商品或市场'}</h1><p>直接描述目标。Agent 会自行调研、决策并创建任务节点，你也可以用 /命令精确控制。</p></div>
        <div className="conversation-messages" ref={messageList}>{!data?.messages.length?<div className="conversation-empty"><Sparkles size={28}/><h2>从一句话开始</h2><p>例如：寻找中国大陆能够单件代发到美国、售价 30 美元以内的产品，并自动生成英文推广内容。</p></div>:data.messages.map(item=><article className={'conversation-message '+item.role} key={item.id}><div className="message-meta"><span>{item.role==='user'?'你':item.role==='system'?'运行记录':'Agent'}</span><time>{new Date(item.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time></div><div className="message-bubble">{item.content}</div></article>)}</div>
        {error&&<div className="conversation-error" role="alert"><span>{error}</span><button onClick={()=>void load()}>重试</button></div>}
        <div className="prompt-suggestions">{prompts.map(prompt=><button key={prompt} disabled={busy} onClick={()=>void send(prompt)}>{prompt}</button>)}</div>
        <form className="conversation-input" onSubmit={submit}><textarea value={message} onChange={event=>setMessage(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void send();}}} placeholder="输入经营目标、问题或 /命令…" maxLength={2000} rows={3}/><button aria-label="发送" disabled={busy||!message.trim()}>{busy?<RefreshCw className="spin" size={18}/>:<ArrowUp size={19}/>}</button></form>
        <div className="conversation-footer"><span>最近动作：{state?.lastAction||'尚未开始'}</span><div>{state?.status==='active'?<button onClick={()=>void send('/pause')} disabled={busy}><Pause size={14}/>暂停</button>:<button onClick={()=>void send('/start')} disabled={busy}><Play size={14}/>启动</button>}<button onClick={()=>void load()}><RefreshCw size={14}/>刷新</button></div></div>
      </section>
      <aside className="task-panel"><div className="task-panel-heading"><div><span>任务节点</span><b>{jobs.length}</b></div><small>{completed} 已完成</small></div>
        <div className="task-list">{jobs.length?jobs.map((job,index)=><Link href={'/automation/jobs/'+job.id} className={'task-node '+job.state} aria-label={'打开任务：'+(jobText[job.kind]||job.kind)} key={job.id}><div className="task-node-marker">{job.state==='succeeded'?<Check size={13}/>:<Clock3 size={13}/>}</div><div><span>节点 {String(jobs.length-index).padStart(2,'0')}</span><h2>{jobText[job.kind]||job.kind}</h2><p>{jobState[job.state]||job.state} · {new Date(job.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</p><code>{job.id.slice(0,8)}</code></div></Link>):<div className="task-empty"><Clock3 size={22}/><p>Agent 创建任务后，会在这里显示执行节点和状态。</p></div>}</div>
        <div className="task-summary"><div><span>订单</span><b>{data?.orders.length||0}</b></div><div><span>财务 / 售后</span><b>{data?.records.filter(item=>['finance_statement','aftersale'].includes(item.recordType)).length||0}</b></div><div><span>下次周期</span><b>{state?.nextCycleAt?new Date(state.nextCycleAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'—'}</b></div></div>
        {state?.lastError&&<div className="task-blocker"><span>当前阻塞</span><p>{state.lastError.replace(/^[A-Z_]+：/,'')}</p></div>}
      </aside>
    </div>
    <QuickSettings open={settingsOpen} onClose={()=>setSettingsOpen(false)} onVerified={()=>void load()}/>
  </main>;
}
