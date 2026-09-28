'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {ArrowUpRight,Check,X} from 'lucide-react';
import type {ConnectorStatus,PublicSettings,Settings} from '@agentsale/automation';

type AdminPayload={settings:PublicSettings;connectors:ConnectorStatus[]};
type QuickForm={provider:'minimax'|'compatible';baseUrl:string;model:string;apiKey:string;searchKey:string};
const empty:QuickForm={provider:'minimax',baseUrl:'https://api.minimaxi.com/v1',model:'MiniMax-M3',apiKey:'',searchKey:''};
const minimaxUrl='https://api.minimaxi.com/v1';

function looksLikeMiniMax(settings:Pick<PublicSettings,'protocol'|'baseUrl'|'model'>){
  return settings.protocol==='minimax'||/minimax/i.test(settings.model)||/api\.minimax/i.test(settings.baseUrl);
}
function normalizedMiniMaxModel(model:string){return /^minimax[-_ ]?m3$/i.test(model.trim())?'MiniMax-M3':model.trim()||'MiniMax-M3';}
function formFromSettings(settings:PublicSettings):{form:QuickForm;corrected:boolean;preserveApiKey:boolean}{
  const minimax=looksLikeMiniMax(settings),mismatched=minimax&&!/api\.minimax/i.test(settings.baseUrl);
  return {form:{provider:minimax?'minimax':'compatible',baseUrl:minimax?minimaxUrl:settings.baseUrl,model:minimax?normalizedMiniMaxModel(settings.model):settings.model,apiKey:'',searchKey:''},corrected:mismatched,preserveApiKey:mismatched&&settings.hasApiKey};
}

export function QuickSettings({open,onClose,onVerified}:{open:boolean;onClose:()=>void;onVerified:()=>void}){
  const [data,setData]=useState<AdminPayload|null>(null),[form,setForm]=useState<QuickForm>(empty),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[preserveApiKey,setPreserveApiKey]=useState(false);
  useEffect(()=>{if(!open)return;setError('');setNotice('');void fetch('/api/v1/admin',{cache:'no-store'}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.message);return body as AdminPayload;}).then(body=>{const normalized=formFromSettings(body.settings);setData(body);setForm(normalized.form);setPreserveApiKey(normalized.preserveApiKey);if(normalized.corrected)setNotice('已在表单中修正 MiniMax 服务地址；点击保存即可，无需重填已保存的密钥。');}).catch(reason=>setError(reason instanceof Error?reason.message:'无法读取配置'));},[open]);
  if(!open)return null;
  function update<K extends keyof QuickForm>(key:K,value:QuickForm[K]){setForm(current=>({...current,[key]:value}));}
  function choose(provider:QuickForm['provider']){setPreserveApiKey(false);setForm(current=>provider==='minimax'?{...current,provider,baseUrl:minimaxUrl,model:normalizedMiniMaxModel(current.model)}:{...current,provider,baseUrl:/api\.minimax/i.test(current.baseUrl)?'https://api.openai.com/v1':current.baseUrl,model:/minimax/i.test(current.model)?'':current.model});}
  async function submit(event:FormEvent){event.preventDefault();if(!data||busy)return;setBusy(true);setError('');setNotice('');try{
    const {hasApiKey:_,hasSearchKey:__,hasMinimaxKey:___,connectorSecretStatus:____,verifiedAt:_____,revision:______,...stored}=data.settings;
    const minimax=form.provider==='minimax';
    const settings:Settings={...stored,protocol:minimax?'minimax':'openai',baseUrl:minimax?minimaxUrl:form.baseUrl.trim(),model:minimax?normalizedMiniMaxModel(form.model):form.model.trim(),format:minimax?'prompt_json':stored.format,callLimitCents:0,dailyLimitCents:0};
    const save=await fetch('/api/v1/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',settings,...(preserveApiKey&&!form.apiKey?{preserveApiKey:true}:{}),...(form.apiKey?{apiKey:form.apiKey}:{}),...(form.searchKey?{searchKey:form.searchKey}:{})})}),saved=await save.json();if(!save.ok)throw new Error(saved.message||'配置保存失败');
    setPreserveApiKey(false);setForm(current=>({...current,provider:minimax?'minimax':'compatible',baseUrl:settings.baseUrl,model:settings.model,apiKey:'',searchKey:''}));setData(current=>({settings:saved.settings,connectors:current?.connectors||[]}));setNotice('配置已保存，正在验证连接…');
    const verify=await fetch('/api/v1/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'verify'})}),verified=await verify.json();if(!verify.ok)throw new Error(`配置已保存，密钥仍在；连接验证失败：${verified.message||'请检查模型名称或服务状态'}`);setData(current=>({settings:{...saved.settings,verifiedAt:new Date().toISOString()},connectors:current?.connectors||[]}));onVerified();onClose();
  }catch(reason){setError(reason instanceof Error?reason.message:'配置未完成');}finally{setBusy(false);}}
  return <div className="settings-overlay" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="quick-settings" role="dialog" aria-modal="true" aria-labelledby="quick-settings-title"><header><div><span>Agent 设置</span><h2 id="quick-settings-title">连接模型</h2></div><button type="button" onClick={onClose} aria-label="关闭"><X size={18}/></button></header>
    <p className="quick-settings-intro">这里只填写 Agent 对话所需的核心参数。平台渠道和低频选项放在高级配置中。</p>
    {error&&<div className="quick-settings-message error" role="alert">{error}</div>}{notice&&<div className="quick-settings-message success" role="status"><Check size={15}/>{notice}</div>}
    {!data?<div className="quick-settings-loading">正在读取本机配置…</div>:<form onSubmit={submit}>
      <label>模型服务<select value={form.provider} onChange={event=>choose(event.target.value as QuickForm['provider'])}><option value="minimax">MiniMax</option><option value="compatible">OpenAI 兼容接口</option></select></label>
      <label>接口地址<input type="url" required value={form.baseUrl} onChange={event=>update('baseUrl',event.target.value)}/></label>
      <label>模型名称<input required value={form.model} onChange={event=>update('model',event.target.value)} placeholder="例如 MiniMax-M3"/></label>
      <label>API 密钥<input type="password" autoComplete="new-password" value={form.apiKey} onChange={event=>update('apiKey',event.target.value)} placeholder={data.settings.hasApiKey?'已保存；留空保持':'输入模型密钥'}/></label>
      <label>搜索密钥 <small>可选</small><input type="password" autoComplete="new-password" value={form.searchKey} onChange={event=>update('searchKey',event.target.value)} placeholder={data.settings.hasSearchKey?'已保存；留空保持':'可加速供应商与公开市场检索'}/></label>
      <button className="quick-settings-primary" disabled={busy}>{busy?'正在验证…':'保存并验证'}</button>
    </form>}
    {data&&<section className="account-settings"><div><b>店铺账号（可选）</b><p>公开市场检索无需登录。授权店铺后，可补充真实销量、曝光、订单和售后数据。</p></div><div className="account-status"><span data-ready={data.connectors.some(item=>item.id==='tiktok_shop'&&item.verified)}>TikTok Shop · {data.connectors.some(item=>item.id==='tiktok_shop'&&item.verified)?'已连接':'未连接'}</span><span data-ready={data.connectors.some(item=>item.id==='temu'&&item.verified)}>Temu · {data.connectors.some(item=>item.id==='temu'&&item.verified)?'已连接':'未连接'}</span></div><a className="advanced-settings-link" href="http://127.0.0.1:3047/?advanced=1#channels">配置与授权店铺账号 <ArrowUpRight size={13}/></a></section>}
  </section></div>;
}
