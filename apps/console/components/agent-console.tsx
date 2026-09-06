'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowUp,Pause,Play,RefreshCw,TerminalSquare} from 'lucide-react';
import type {CommerceAgentSnapshot} from '@agentsale/automation';

const statusLabels={idle:'未启动',active:'自动运行',paused:'已暂停',blocked:'受阻'} as const;
const starters=['/status','/start','/run','/goal 寻找支持中国单件代发、适合美国市场测试的轻小家居产品','/budget 2.00','/help'];
export function AgentConsole(){
  const [data,setData]=useState<CommerceAgentSnapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');const messages=useRef<HTMLDivElement>(null);
  async function load(){const response=await fetch('/api/v1/agent',{cache:'no-store'}),body=await response.json();if(!response.ok)throw new Error(body.message||'无法读取 Agent');setData(body);}
  useEffect(()=>{const refresh=()=>void load().catch(e=>setError(e.message));refresh();const timer=setInterval(refresh,3000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{const frame=requestAnimationFrame(()=>{const container=messages.current;if(container)container.scrollTop=container.scrollHeight;});return()=>cancelAnimationFrame(frame);},[data?.messages.length]);
  async function send(text=message){if(!text.trim()||busy)return;setBusy(true);setError('');setMessage('');try{const response=await fetch('/api/v1/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text})}),body=await response.json();if(!response.ok)throw new Error(body.message||'Agent 未完成操作');setData(body.snapshot);}catch(e){setError(e instanceof Error?e.message:'Agent 未完成操作');}finally{setBusy(false);}}
  function submit(event:FormEvent){event.preventDefault();void send();}
  const state=data?.state;
  return <div className="agent-console">
    <section className="agent-statusbar"><div><span className="eyebrow">AUTONOMOUS COMMERCE AGENT</span><h2>告诉 Agent 经营目标，剩余步骤持续自动执行</h2><p>{state?.objective||'正在读取目标…'}</p></div><div className="agent-runtime"><span className={'runtime-dot '+(state?.status||'idle')}/><div><b>{state?statusLabels[state.status]:'连接中'}</b><small>{state?`$${(state.cycleBudgetCents/100).toFixed(2)} / 周期 · ${Math.round(state.cycleIntervalSeconds/60)} 分钟`:'—'}</small></div></div></section>
    <div className="agent-workspace">
      <aside className="agent-roles"><h3>执行团队</h3>{[['研究','搜索供应商与供货证据',data?.capabilities.search],['决策','分析平台指标与成本',true],['内容','生成文案、海报和视频',data?.capabilities.model],['渠道','发布、引流与回读',data?.capabilities.publishingConnector],['订单','订单、物流与售后',data?.capabilities.orderConnector]].map(([name,detail,ready])=><div className="agent-role" key={String(name)}><span className={ready?'ready':'waiting'}/><div><b>{String(name)} Agent</b><small>{String(detail)}</small></div></div>)}<div className="agent-boundary"><b>当前阻塞</b><p>{state?.lastError?state.lastError.replace(/^[A-Z_]+：/,''):'无'}</p></div></aside>
      <section className="agent-chat" aria-label="Agent 对话">
        <div className="agent-messages" ref={messages}>{!data?.messages.length&&<div className="agent-welcome"><TerminalSquare size={30} strokeWidth={1.2}/><h3>从一句话开始</h3><p>例如：“持续寻找能从中国单件代发到美国、售价 30 美元以内的产品，每 30 分钟评估一次。”</p></div>}{data?.messages.map(item=><div key={item.id} className={'agent-message '+item.role}><div className="message-role">{item.role==='user'?'你':item.role==='system'?'运行记录':'Agent'}</div><div className="message-body">{item.content}</div><time>{new Date(item.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time></div>)}</div>
        {error&&<p className="feedback error" role="alert">{error}</p>}
        <div className="command-strip">{starters.map(command=><button key={command} onClick={()=>void send(command)} disabled={busy}>{command.length>18?command.slice(0,18)+'…':command}</button>)}</div>
        <form className="agent-prompt" onSubmit={submit}><textarea value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send();}}} placeholder="输入目标、问题或 /命令。Enter 执行，Shift+Enter 换行。" maxLength={2000} rows={2}/><button aria-label="发送给 Agent" disabled={busy||!message.trim()}>{busy?<RefreshCw className="spin" size={17}/>:<ArrowUp size={18}/>}</button></form>
        <div className="agent-controls"><span>最近动作：{state?.lastAction||'—'}</span><div>{state?.status==='active'?<button className="btn text" onClick={()=>void send('/pause')} disabled={busy}><Pause size={13}/>暂停</button>:<button className="btn text" onClick={()=>void send('/start')} disabled={busy}><Play size={13}/>启动</button>}<button className="btn text" onClick={()=>void load()}><RefreshCw size={13}/>刷新</button></div></div>
      </section>
    </div>
  </div>;
}
