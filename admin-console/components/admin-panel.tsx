'use client';
import {useEffect,useState,type ChangeEvent,type FormEvent} from 'react';
import type {PublicSettings,Settings} from '@agentsale/automation';
import {matchingModelPreset,modelPresets,protocolForModelEndpoint} from './model-presets';
import {VoicePicker} from './voice-picker';
import {SpeechTest} from './speech-test';

type AdminData={settings:PublicSettings};

export function AdminPanel(){
  const [data,setData]=useState<AdminData|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[selectedPreset,setSelectedPreset]=useState('custom'),[voicesText,setVoicesText]=useState('');
  async function load(resetForm=false){const response=await fetch('/api/v1/admin',{cache:'no-store'}),body=await response.json();if(!response.ok)throw new Error(body.message);setData(body);if(resetForm){setSelectedPreset(matchingModelPreset(body.settings));setVoicesText(body.settings.minimax.voices.map((voice:{id:string;name:string})=>voice.id+' | '+voice.name).join('\n'));}}
  useEffect(()=>{void load(true).catch(e=>setError(e.message));},[]);
  async function post(body:unknown){setBusy(true);setError('');setNotice('');try{const response=await fetch('/api/v1/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json();if(!response.ok)throw new Error(result.message);setNotice(result.message);await load(Boolean(result.settings));}catch(e){setError(e instanceof Error?e.message:'管理操作失败');}finally{setBusy(false);}}
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!data)return;
    const form=new FormData(event.currentTarget),{hasApiKey:_,hasMinimaxKey:__,hasAggregateKey:___,verifiedAt:____,revision:_____,...stored}=data.settings;
    const baseUrl=String(form.get('baseUrl')||'').trim();
    const voices=String(form.get('voices')||'').split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{const [id,name]=line.split('|').map(part=>part.trim());return {id,name:name||id};});
    const settings:Settings={...stored,baseUrl,model:String(form.get('model')||'').trim(),protocol:protocolForModelEndpoint(baseUrl),localModel:form.get('localModel')==='on',format:form.get('format') as Settings['format'],independentAudioEnabled:form.get('speechEnabled')==='on',independentAudioBaseUrl:form.get('audioBaseUrl') as Settings['independentAudioBaseUrl'],minimax:{...stored.minimax,speechModel:String(form.get('speechModel')||'').trim(),voices}};
    const apiKey=String(form.get('apiKey')||''),minimaxKey=String(form.get('minimaxKey')||'');
    await post({action:'save',revision:data.settings.revision,settings,...(form.get('clearApiKey')?{apiKey:''}:apiKey?{apiKey}:{}),...(form.get('clearMinimaxKey')?{minimaxKey:''}:minimaxKey?{minimaxKey}:{})});
  }
  function choosePreset(event:ChangeEvent<HTMLSelectElement>){
    setSelectedPreset(event.currentTarget.value);
    const preset=modelPresets.find(item=>item.id===event.currentTarget.value),form=event.currentTarget.form;
    if(!preset||!form)return;
    for(const name of ['baseUrl','model','format'] as const){const field=form.elements.namedItem(name) as HTMLInputElement|HTMLSelectElement|null;if(field)field.value=preset[name];}
    const localModel=form.elements.namedItem('localModel') as HTMLInputElement|null;if(localModel)localModel.checked=false;
  }
  const presetDescription=modelPresets.find(preset=>preset.id===selectedPreset)?.description;
  return <div className="admin-panel">{error&&<p role="alert" className="feedback error">{error}</p>}{notice&&<p role="status" className="feedback">{notice}</p>}{data&&<form id="services" key={data.settings.revision} onSubmit={save}>
    <div className="sectionrow"><h2>普通文本与音频模型接口</h2><span className="status">{data.settings.verifiedAt?'文本已验证 · '+new Date(data.settings.verifiedAt).toLocaleString():'文本尚未验证'}</span></div>
    <p className="muted small">保留单独的文本接口与音频接口配置。MiniMax 单密钥聚合连接位于左侧“MiniMax 聚合”标签；公开网页搜索与正文读取由桌面 Agent 执行。</p>
    <div className="model-preset-row spaced"><label className="field model-preset-field">服务商预设<select name="preset" value={selectedPreset} onChange={choosePreset}><option value="custom">自定义配置</option>{modelPresets.map(preset=><option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label><p className="model-preset-help">{presetDescription?presetDescription+' ':''}选择后填入参考参数；密钥需自行配置。</p></div>
    <div className="form-grid spaced">
      <label className="field">模型接口地址<input name="baseUrl" type="url" required defaultValue={data.settings.baseUrl} onChange={()=>setSelectedPreset('custom')}/></label>
      <label className="field">模型名称<input name="model" required defaultValue={data.settings.model} onChange={()=>setSelectedPreset('custom')} placeholder="服务商提供的模型 ID"/></label>
      <label className="field">模型 API 密钥<input name="apiKey" type="password" autoComplete="new-password" placeholder={data.settings.hasApiKey?'已保存，留空保持':'输入密钥，仅保存到服务端保护区'}/></label>
      <label className="field">结构化输出<select name="format" defaultValue={data.settings.format} onChange={()=>setSelectedPreset('custom')}><option value="json_schema">JSON Schema</option><option value="json_object">JSON 模式</option><option value="prompt_json">提示词 JSON</option></select></label>
    </div>
    <label className="check-field spaced"><input name="localModel" type="checkbox" defaultChecked={data.settings.localModel}/>使用本机模型</label>
    <label className="check-field spaced"><input name="clearApiKey" type="checkbox"/>清除已保存的模型密钥</label>
    <p className="footnote">更换接口地址或本机模式时，原模型密钥会清除。输出长度由模型服务决定；服务商自身限制仍然适用。</p>
    <div className="sectionrow spaced"><h2>普通音频接口与音色列表</h2></div>
    <div className="form-grid spaced">
      <label className="check-field"><input name="speechEnabled" type="checkbox" defaultChecked={data.settings.independentAudioEnabled}/>启用独立音频模型</label>
      <label className="field">独立音频接口<select name="audioBaseUrl" defaultValue={data.settings.independentAudioBaseUrl}><option>https://api.minimax.cn/v1</option><option>https://api.minimaxi.com/v1</option><option>https://api.minimax.io/v1</option></select></label>
      <p className="muted small">独立音频接口使用下方密钥，可与聚合连接同时启用；调用顺序在“服务路由”配置。</p>
      <label className="field">语音模型 ID<input name="speechModel" required maxLength={100} defaultValue={data.settings.minimax.speechModel}/></label>
      <label className="field">独立音频 API 密钥<input name="minimaxKey" type="password" autoComplete="new-password" placeholder={data.settings.hasMinimaxKey?'已保存，留空保持':'输入独立音频密钥'}/></label>
      <VoicePicker providerId="standard" hasSavedKey={data.settings.hasMinimaxKey} value={voicesText} onChange={setVoicesText} disabled={busy}/>
      <label className="check-field"><input name="clearMinimaxKey" type="checkbox"/>清除已保存的音频密钥</label>
    </div>
    <SpeechTest providerId="standard" settings={data.settings} disabled={busy}/>
    <div className="actions spaced"><button className="btn primary" disabled={busy}>保存普通模型配置</button><button className="btn" type="button" disabled={busy} onClick={()=>post({action:'verify'})}>测试当前文本连接</button></div>
  </form>}</div>;
}
