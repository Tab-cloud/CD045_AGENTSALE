'use client';
import {useEffect,useState,type ChangeEvent,type FormEvent} from 'react';
import type {PublicSettings,Settings} from '@agentsale/automation';
import {matchingModelPreset,modelPresets,protocolForModelEndpoint} from './model-presets';

type AdminData={settings:PublicSettings};

export function AdminPanel(){
  const [data,setData]=useState<AdminData|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[selectedPreset,setSelectedPreset]=useState('custom');
  async function load(){const response=await fetch('/api/v1/admin',{cache:'no-store'}),body=await response.json();if(!response.ok)throw new Error(body.message);setData(body);setSelectedPreset(matchingModelPreset(body.settings));}
  useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
  async function post(body:unknown){setBusy(true);setError('');setNotice('');try{const response=await fetch('/api/v1/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json();if(!response.ok)throw new Error(result.message);setNotice(result.message);await load();}catch(e){setError(e instanceof Error?e.message:'管理操作失败');}finally{setBusy(false);}}
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!data)return;const d=new FormData(event.currentTarget);
    const {hasApiKey:_,hasMinimaxKey:__,verifiedAt:____,revision:_____,...stored}=data.settings;
    const baseUrl=String(d.get('baseUrl')).trim();
    const settings:Settings={...stored,protocol:protocolForModelEndpoint(baseUrl),baseUrl,model:String(d.get('model')).trim(),localModel:d.get('localModel')==='on',format:d.get('format') as Settings['format'],minimax:{...stored.minimax,baseUrl:String(d.get('audioBaseUrl')) as Settings['minimax']['baseUrl'],speechModel:String(d.get('speechModel')).trim(),voiceId:String(d.get('voiceId')).trim(),enabled:d.get('speechEnabled')==='on'}};
    const apiKey=String(d.get('apiKey')||'');
    const minimaxKey=String(d.get('minimaxKey')||'');
    await post({action:'save',revision:data.settings.revision,settings,...(d.get('clearApiKey')?{apiKey:''}:apiKey?{apiKey}:{}),...(d.get('clearMinimaxKey')?{minimaxKey:''}:minimaxKey?{minimaxKey}:{})});
  }
  function choosePreset(event:ChangeEvent<HTMLSelectElement>){
    setSelectedPreset(event.currentTarget.value);
    const preset=modelPresets.find(item=>item.id===event.currentTarget.value);
    if(!preset)return;
    const form=event.currentTarget.form;
    if(!form)return;
    for(const name of ['baseUrl','model','format'] as const){
      const field=form.elements.namedItem(name) as HTMLInputElement|HTMLSelectElement|null;
      if(field)field.value=preset[name];
    }
    const localModel=form.elements.namedItem('localModel') as HTMLInputElement|null;
    if(localModel)localModel.checked=false;
  }
  function markCustom(){setSelectedPreset('custom');}
  const presetDescription=modelPresets.find(preset=>preset.id===selectedPreset)?.description;
  return <div className="admin-panel">{error&&<p role="alert" className="feedback error">{error}</p>}{notice&&<p role="status" className="feedback">{notice}</p>}{data&&<form id="services" key={data.settings.revision} onSubmit={save}>
    <div className="sectionrow"><h2>文本模型</h2><span className="status">{data.settings.verifiedAt?'已验证 · '+new Date(data.settings.verifiedAt).toLocaleString():'尚未验证'}</span></div>
    <p className="muted small">此处仅配置 Agent 使用的模型接口。文本接口须支持 OpenAI 兼容的流式响应；保存后请测试连接。公开网页搜索与正文读取由 Agent 在任务中调用，无需另填搜索密钥；密钥明文不会返回浏览器。</p>
    <div className="model-preset-row spaced">
      <label className="field model-preset-field">服务商预设<select name="preset" value={selectedPreset} onChange={choosePreset}><option value="custom">自定义配置</option>{modelPresets.map(preset=><option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
      <p className="model-preset-help">{presetDescription?`${presetDescription} `:''}选择后填入参考参数；密钥需自行配置，保存前可修改。</p>
    </div>
    <div className="form-grid spaced">
      <label className="field">模型接口地址<input name="baseUrl" type="url" required defaultValue={data.settings.baseUrl} onChange={markCustom}/></label>
      <label className="field">模型名称<input name="model" required defaultValue={data.settings.model} onChange={markCustom} placeholder="填写服务商提供的模型 ID"/></label>
      <label className="field">模型 API 密钥<input name="apiKey" type="password" autoComplete="new-password" placeholder={data.settings.hasApiKey?'已保存，留空保持':'输入密钥，仅保存到服务端保护区'}/></label>
      <label className="field">结构化输出<select name="format" defaultValue={data.settings.format} onChange={markCustom}><option value="json_schema">JSON Schema</option><option value="json_object">JSON 模式</option><option value="prompt_json">提示词 JSON</option></select></label>
    </div>
    <label className="check-field spaced"><input name="localModel" type="checkbox" defaultChecked={data.settings.localModel} onChange={markCustom}/>使用本机模型</label>
    <label className="check-field spaced"><input name="clearApiKey" type="checkbox"/>清除已保存的模型密钥</label>
    <p className="footnote">更换模型接口地址或本机模式时，原模型密钥会清除。输出长度由模型服务决定；服务商自身限制仍然适用。</p>
    <div className="sectionrow spaced"><h2>音频模型 · MiniMax 语音合成</h2></div>
    <p className="muted small">音频能力按独立会员额度计费。启用后通过平台模型网关调用；密钥仅保存在服务端。</p>
    <div className="form-grid spaced">
      <label className="field">音频模型接口<select name="audioBaseUrl" defaultValue={data.settings.minimax.baseUrl}><option>https://api.minimax.cn/v1</option><option>https://api.minimaxi.com/v1</option><option>https://api.minimax.io/v1</option></select></label>
      <label className="field">语音模型 ID<input name="speechModel" required maxLength={100} defaultValue={data.settings.minimax.speechModel}/></label>
      <label className="field">音色 ID<input name="voiceId" required maxLength={100} defaultValue={data.settings.minimax.voiceId}/></label>
      <label className="check-field"><input name="speechEnabled" type="checkbox" defaultChecked={data.settings.minimax.enabled}/>启用音频模型</label>
      <label className="field">音频 API 密钥<input name="minimaxKey" type="password" autoComplete="new-password" placeholder={data.settings.hasMinimaxKey?'已保存，留空保持':'输入音频模型密钥'}/></label>
    </div>
    <label className="check-field spaced"><input name="clearMinimaxKey" type="checkbox"/>清除已保存的音频密钥</label>
    <div className="actions spaced"><button className="btn primary" disabled={busy}>保存模型供应商配置</button><button className="btn" type="button" disabled={busy} onClick={()=>post({action:'verify'})}>测试文本模型连接</button></div>
  </form>}</div>;
}
