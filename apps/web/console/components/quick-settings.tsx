'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {Check,X} from 'lucide-react';
import type {PublicSettings,Settings} from '@agentsale/automation';

type AdminPayload={settings:PublicSettings};
type QuickForm={provider:'minimax'|'compatible';baseUrl:string;model:string;apiKey:string};
const empty:QuickForm={provider:'minimax',baseUrl:'https://api.minimaxi.com/v1',model:'MiniMax-M3',apiKey:''};
const minimaxUrl='https://api.minimaxi.com/v1';

function looksLikeMiniMax(settings:Pick<PublicSettings,'protocol'|'baseUrl'|'model'>){
  return settings.protocol==='minimax'||/minimax/i.test(settings.model)||/api\.minimax/i.test(settings.baseUrl);
}
function normalizedMiniMaxModel(model:string){return /^minimax[-_ ]?m3$/i.test(model.trim())?'MiniMax-M3':model.trim()||'MiniMax-M3';}
function formFromSettings(settings:PublicSettings):{form:QuickForm;corrected:boolean;preserveApiKey:boolean}{
  const minimax=looksLikeMiniMax(settings),mismatched=minimax&&!/api\.minimax/i.test(settings.baseUrl);
  return {form:{provider:minimax?'minimax':'compatible',baseUrl:minimax?minimaxUrl:settings.baseUrl,model:minimax?normalizedMiniMaxModel(settings.model):settings.model,apiKey:''},corrected:mismatched,preserveApiKey:mismatched&&settings.hasApiKey};
}

export function QuickSettings({open,onClose,onVerified}:{open:boolean;onClose:()=>void;onVerified:()=>void}){
  const [data,setData]=useState<AdminPayload|null>(null),[form,setForm]=useState<QuickForm>(empty),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[preserveApiKey,setPreserveApiKey]=useState(false);
  useEffect(()=>{if(!open)return;setError('');setNotice('');void fetch('/api/v1/admin',{cache:'no-store'}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.message);return body as AdminPayload;}).then(body=>{const normalized=formFromSettings(body.settings);setData(body);setForm(normalized.form);setPreserveApiKey(normalized.preserveApiKey);if(normalized.corrected)setNotice('已在表单中修正 MiniMax 服务地址；点击保存即可，无需重填已保存的密钥。');}).catch(reason=>setError(reason instanceof Error?reason.message:'无法读取配置'));},[open]);
  if(!open)return null;
  function update<K extends keyof QuickForm>(key:K,value:QuickForm[K]){setForm(current=>({...current,[key]:value}));}
  function choose(provider:QuickForm['provider']){setPreserveApiKey(false);setForm(current=>provider==='minimax'?{...current,provider,baseUrl:minimaxUrl,model:normalizedMiniMaxModel(current.model)}:{...current,provider,baseUrl:/api\.minimax/i.test(current.baseUrl)?'https://api.openai.com/v1':current.baseUrl,model:/minimax/i.test(current.model)?'':current.model});}
  async function submit(event:FormEvent){event.preventDefault();if(!data||busy)return;setBusy(true);setError('');setNotice('');try{
    const {hasApiKey:_,hasMinimaxKey:__,connectorSecretStatus:___,verifiedAt:____,revision:_____,...stored}=data.settings;
    const minimax=form.provider==='minimax';
    const settings:Settings={...stored,protocol:minimax?'minimax':'openai',baseUrl:minimax?minimaxUrl:form.baseUrl.trim(),model:minimax?normalizedMiniMaxModel(form.model):form.model.trim(),format:minimax?'prompt_json':stored.format,callLimitCents:0,dailyLimitCents:0};
    const save=await fetch('/api/v1/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',revision:data.settings.revision,settings,...(preserveApiKey&&!form.apiKey?{preserveApiKey:true}:{}),...(form.apiKey?{apiKey:form.apiKey}:{})})}),saved=await save.json();if(!save.ok)throw new Error(saved.message||'配置保存失败');
    setPreserveApiKey(false);setForm(current=>({...current,provider:minimax?'minimax':'compatible',baseUrl:settings.baseUrl,model:settings.model,apiKey:''}));setData({settings:saved.settings});setNotice('配置已保存，正在验证连接…');
    const verify=await fetch('/api/v1/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'verify'})}),verified=await verify.json();if(!verify.ok)throw new Error(`配置已保存，密钥仍在；连接验证失败：${verified.message||'请检查模型名称或服务状态'}`);setData({settings:{...saved.settings,verifiedAt:new Date().toISOString()}});onVerified();onClose();
  }catch(reason){setError(reason instanceof Error?reason.message:'配置未完成');}finally{setBusy(false);}}
  return <div className="settings-overlay" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="quick-settings" role="dialog" aria-modal="true" aria-labelledby="quick-settings-title"><header><div><span>Agent 设置</span><h2 id="quick-settings-title">连接模型</h2></div><button type="button" onClick={onClose} aria-label="关闭"><X size={18}/></button></header>
    <p className="quick-settings-intro">配置 Agent 使用的模型接口。网页搜索与正文读取由 Agent 按任务调用。</p>
    {error&&<div className="quick-settings-message error" role="alert">{error}</div>}{notice&&<div className="quick-settings-message success" role="status"><Check size={15}/>{notice}</div>}
    {!data?<div className="quick-settings-loading">正在读取本机配置…</div>:<form onSubmit={submit}>
      <label>模型服务<select value={form.provider} onChange={event=>choose(event.target.value as QuickForm['provider'])}><option value="minimax">MiniMax</option><option value="compatible">OpenAI 兼容接口</option></select></label>
      <label>接口地址<input type="url" required value={form.baseUrl} onChange={event=>update('baseUrl',event.target.value)}/></label>
      <label>模型名称<input required value={form.model} onChange={event=>update('model',event.target.value)} placeholder="例如 MiniMax-M3"/></label>
      <label>API 密钥<input type="password" autoComplete="new-password" value={form.apiKey} onChange={event=>update('apiKey',event.target.value)} placeholder={data.settings.hasApiKey?'已保存；留空保持':'输入模型密钥'}/></label>
      <button className="quick-settings-primary" disabled={busy}>{busy?'正在验证…':'保存并验证'}</button>
    </form>}
  </section></div>;
}
