'use client';
import {useEffect,useState,type FormEvent} from 'react';
import type {PublicSettings,Settings} from '@agentsale/automation';

type AdminData={settings:PublicSettings};

export function AdminPanel(){
  const [data,setData]=useState<AdminData|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  async function load(){const response=await fetch('/api/v1/admin',{cache:'no-store'}),body=await response.json();if(!response.ok)throw new Error(body.message);setData(body);}
  useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
  async function post(body:unknown){setBusy(true);setError('');setNotice('');try{const response=await fetch('/api/v1/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json();if(!response.ok)throw new Error(result.message);setNotice(result.message);await load();}catch(e){setError(e instanceof Error?e.message:'管理操作失败');}finally{setBusy(false);}}
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!data)return;const d=new FormData(event.currentTarget);
    const {hasApiKey:_,hasMinimaxKey:__,connectorSecretStatus:___,verifiedAt:____,revision:_____,...stored}=data.settings;
    const settings:Settings={...stored,protocol:d.get('protocol') as Settings['protocol'],baseUrl:String(d.get('baseUrl')).trim(),model:String(d.get('model')).trim(),localModel:d.get('localModel')==='on',format:d.get('format') as Settings['format']};
    const apiKey=String(d.get('apiKey')||'');
    await post({action:'save',revision:data.settings.revision,settings,...(d.get('clearApiKey')?{apiKey:''}:apiKey?{apiKey}:{})});
  }
  return <div className="admin-panel">{error&&<p role="alert" className="feedback error">{error}</p>}{notice&&<p role="status" className="feedback">{notice}</p>}{data&&<form id="services" key={data.settings.revision} onSubmit={save}>
    <div className="sectionrow"><h2>模型接口</h2><span className="status">{data.settings.verifiedAt?'已验证 · '+new Date(data.settings.verifiedAt).toLocaleString():'尚未验证'}</span></div>
    <p className="muted small">此处仅配置 Agent 使用的模型接口。公开网页搜索与正文读取由 Agent 在任务中调用，无需另填搜索密钥；密钥明文不会返回浏览器。</p>
    <div className="form-grid spaced">
      <label className="field">文本服务协议<select name="protocol" defaultValue={data.settings.protocol}><option value="openai">通用兼容接口</option><option value="minimax">MiniMax（分离推理输出）</option></select></label>
      <button type="button" className="btn" onClick={e=>{const f=e.currentTarget.form!;for(const [name,value] of Object.entries({protocol:'minimax',baseUrl:'https://api.minimax.cn/v1',model:'MiniMax-M3',format:'prompt_json'}))(f.elements.namedItem(name) as HTMLInputElement).value=value;(f.elements.namedItem('localModel') as HTMLInputElement).checked=false;}}>填入 MiniMax 文本参数</button>
      <label className="field">模型接口地址<input name="baseUrl" type="url" required defaultValue={data.settings.baseUrl}/></label>
      <label className="field">模型名称<input name="model" required defaultValue={data.settings.model} placeholder="填写服务商提供的模型 ID"/></label>
      <label className="field">模型 API 密钥<input name="apiKey" type="password" autoComplete="new-password" placeholder={data.settings.hasApiKey?'已保存，留空保持':'输入密钥，仅保存到服务端保护区'}/></label>
      <label className="field">结构化输出<select name="format" defaultValue={data.settings.format}><option value="json_schema">JSON Schema</option><option value="json_object">JSON 模式</option><option value="prompt_json">提示词 JSON</option></select></label>
    </div>
    <label className="check-field spaced"><input name="localModel" type="checkbox" defaultChecked={data.settings.localModel}/>使用本机模型</label>
    <label className="check-field spaced"><input name="clearApiKey" type="checkbox"/>清除已保存的模型密钥</label>
    <p className="footnote">更换模型接口地址或本机模式时，原模型密钥会清除。输出长度由模型服务决定；服务商自身限制仍然适用。</p>
    <div className="actions spaced"><button className="btn primary" disabled={busy}>保存模型配置</button><button className="btn" type="button" disabled={busy} onClick={()=>post({action:'verify'})}>测试模型连接</button></div>
  </form>}</div>;
}
