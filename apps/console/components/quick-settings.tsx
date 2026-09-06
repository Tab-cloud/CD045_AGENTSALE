'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {ArrowUpRight,Check,X} from 'lucide-react';
import type {PublicSettings,Settings} from '@agentsale/automation';

type AdminPayload={settings:PublicSettings};
type QuickForm={provider:'minimax'|'compatible';baseUrl:string;model:string;apiKey:string;searchKey:string;callLimit:string;dailyLimit:string};
const empty:QuickForm={provider:'minimax',baseUrl:'https://api.minimaxi.com/v1',model:'MiniMax-M3',apiKey:'',searchKey:'',callLimit:'0.25',dailyLimit:'2.00'};

export function QuickSettings({open,onClose,onVerified}:{open:boolean;onClose:()=>void;onVerified:()=>void}){
  const [data,setData]=useState<AdminPayload|null>(null),[form,setForm]=useState<QuickForm>(empty),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{if(!open)return;setError('');setNotice('');void fetch('/api/v1/admin',{cache:'no-store'}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.message);return body as AdminPayload;}).then(body=>{setData(body);setForm({provider:body.settings.protocol==='minimax'?'minimax':'compatible',baseUrl:body.settings.baseUrl,model:body.settings.model,apiKey:'',searchKey:'',callLimit:(body.settings.callLimitCents/100).toFixed(2),dailyLimit:(body.settings.dailyLimitCents/100).toFixed(2)});}).catch(reason=>setError(reason instanceof Error?reason.message:'无法读取配置'));},[open]);
  if(!open)return null;
  function update<K extends keyof QuickForm>(key:K,value:QuickForm[K]){setForm(current=>({...current,[key]:value}));}
  function choose(provider:QuickForm['provider']){setForm(current=>provider==='minimax'?{...current,provider,baseUrl:'https://api.minimaxi.com/v1',model:current.model||'MiniMax-M3'}:{...current,provider});}
  async function submit(event:FormEvent){event.preventDefault();if(!data||busy)return;setBusy(true);setError('');setNotice('');try{
    const {hasApiKey:_,hasSearchKey:__,hasMinimaxKey:___,connectorSecretStatus:____,verifiedAt:_____,revision:______,...stored}=data.settings;
    const settings:Settings={...stored,protocol:form.provider==='minimax'?'minimax':'openai',baseUrl:form.baseUrl.trim(),model:form.model.trim(),format:form.provider==='minimax'?'prompt_json':stored.format,callLimitCents:Math.round(Number(form.callLimit)*100),dailyLimitCents:Math.round(Number(form.dailyLimit)*100)};
    const save=await fetch('/api/v1/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',settings,...(form.apiKey?{apiKey:form.apiKey}:{}),...(form.searchKey?{searchKey:form.searchKey}:{})})}),saved=await save.json();if(!save.ok)throw new Error(saved.message||'配置保存失败');
    const verify=await fetch('/api/v1/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'verify'})}),verified=await verify.json();if(!verify.ok)throw new Error(`配置已保存；连接验证失败：${verified.message||'请检查参数'}`);setNotice('模型已保存并验证，Agent 可以理解自由文本。');setForm(current=>({...current,apiKey:'',searchKey:''}));setData(current=>current?{...current,settings:{...saved.settings,verifiedAt:new Date().toISOString()}}:current);onVerified();
  }catch(reason){setError(reason instanceof Error?reason.message:'配置未完成');}finally{setBusy(false);}}
  return <div className="settings-overlay" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="quick-settings" role="dialog" aria-modal="true" aria-labelledby="quick-settings-title"><header><div><span>Agent 设置</span><h2 id="quick-settings-title">连接模型</h2></div><button type="button" onClick={onClose} aria-label="关闭"><X size={18}/></button></header>
    <p className="quick-settings-intro">这里只填写 Agent 对话所需的核心参数。平台渠道和低频选项放在高级配置中。</p>
    {error&&<div className="quick-settings-message error" role="alert">{error}</div>}{notice&&<div className="quick-settings-message success" role="status"><Check size={15}/>{notice}</div>}
    {!data?<div className="quick-settings-loading">正在读取本机配置…</div>:<form onSubmit={submit}>
      <label>模型服务<select value={form.provider} onChange={event=>choose(event.target.value as QuickForm['provider'])}><option value="minimax">MiniMax</option><option value="compatible">OpenAI 兼容接口</option></select></label>
      <label>接口地址<input type="url" required value={form.baseUrl} onChange={event=>update('baseUrl',event.target.value)}/></label>
      <label>模型名称<input required value={form.model} onChange={event=>update('model',event.target.value)} placeholder="例如 MiniMax-M3"/></label>
      <label>API 密钥<input type="password" autoComplete="new-password" value={form.apiKey} onChange={event=>update('apiKey',event.target.value)} placeholder={data.settings.hasApiKey?'已保存；留空保持':'输入模型密钥'}/></label>
      <label>搜索密钥 <small>可选</small><input type="password" autoComplete="new-password" value={form.searchKey} onChange={event=>update('searchKey',event.target.value)} placeholder={data.settings.hasSearchKey?'已保存；留空保持':'用于自动寻找供应商'}/></label>
      <div className="quick-budget"><label>单次上限 · USD<input type="number" min="0" max="100" step="0.01" value={form.callLimit} onChange={event=>update('callLimit',event.target.value)}/></label><label>每日上限 · USD<input type="number" min="0" max="1000" step="0.01" value={form.dailyLimit} onChange={event=>update('dailyLimit',event.target.value)}/></label></div>
      <button className="quick-settings-primary" disabled={busy}>{busy?'正在验证…':'保存并验证'}</button>
    </form>}
    <a className="advanced-settings-link" href="http://127.0.0.1:3047/?advanced=1">渠道与高级配置 <ArrowUpRight size={13}/></a>
  </section></div>;
}
