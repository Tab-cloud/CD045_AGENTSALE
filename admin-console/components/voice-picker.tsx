'use client';
import {useState} from 'react';
import {appendVoices} from './voice-list';

type AvailableVoice={id:string;name:string;source:'system'|'voice_cloning'|'voice_generation'};
type Props={providerId:'standard'|'minimax';hasSavedKey:boolean;value:string;onChange:(value:string)=>void;disabled?:boolean};
const sourceNames={system:'系统音色',voice_cloning:'克隆音色',voice_generation:'生成音色'};

export function VoicePicker({providerId,hasSavedKey,value,onChange,disabled=false}:Props){
  const [voices,setVoices]=useState<AvailableVoice[]|null>(null);
  const [search,setSearch]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const configured=new Set(value.split('\n').map(line=>line.split('|')[0].trim()).filter(Boolean));
  const visible=voices?.filter(voice=>(voice.id+' '+voice.name+' '+sourceNames[voice.source]).toLocaleLowerCase().includes(search.toLocaleLowerCase()))||[];
  const remaining=voices?.filter(voice=>!configured.has(voice.id)).length||0;
  async function query(){
    setLoading(true);setError('');setNotice('');setVoices(null);
    try{
      const response=await fetch('/api/v1/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'listVoices',providerId})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.message||'音色查询失败');
      setVoices(body.voices);
    }catch(cause){setError(cause instanceof Error?cause.message:'音色查询失败');}
    finally{setLoading(false);}
  }
  function add(selected:AvailableVoice[]){
    const result=appendVoices(value,selected);
    if(!result.added)return;
    onChange(result.value);
    setError('');
    setNotice(`已加入 ${result.added} 个音色，请保存本页配置`);
  }
  return <div className="voice-picker">
    <label className="field">可用音色列表（每行：ID | 名称）<textarea name="voices" required rows={4} value={value} onChange={event=>onChange(event.currentTarget.value)}/></label>
    <div className="voice-picker-actions"><button className="btn" type="button" disabled={disabled||loading||!hasSavedKey} onClick={query}>{loading?'正在查询音色…':'从 MiniMax 查询音色'}</button><span className="muted small">查询已保存的连接；修改密钥或地址后请先保存。手工填写仍可使用。</span></div>
    <p className="muted small">普通连接与聚合连接共用这份开放列表；请确认所选音色在实际调用的密钥下可用。</p>
    {!hasSavedKey&&<p className="muted small">先保存此连接的 API 密钥，即可查询该账号可用的音色。</p>}
    {error&&<p role="alert" className="feedback error">{error}</p>}
    {notice&&<p role="status" className="feedback">{notice}</p>}
    {voices&&<div className="voice-picker-results">
      <div className="voice-picker-summary"><strong>查到 {voices.length} 个音色</strong><div><span>新增后仍需保存本页配置</span><button type="button" className="btn" disabled={disabled||remaining===0} onClick={()=>add(voices)}>一键添加全部{remaining>0?`（${remaining}）`:''}</button></div></div>
      <label className="field">筛选音色<input type="search" value={search} onChange={event=>setSearch(event.currentTarget.value)} placeholder="搜索音色名称、ID 或类型"/></label>
      <div className="voice-picker-list">{visible.map(voice=><div className="voice-picker-row" key={voice.id}><div><span className="voice-picker-name">{voice.name}</span><span className="voice-picker-source">{sourceNames[voice.source]}</span><code>{voice.id}</code></div><button type="button" className="btn" disabled={disabled||configured.has(voice.id)} onClick={()=>add([voice])}>{configured.has(voice.id)?'已加入':'加入'}</button></div>)}{visible.length===0&&<p className="muted small">没有匹配的音色</p>}</div>
      <p className="muted small">账号可见不代表适配所有语音模型；克隆音色通常需要先成功用于语音合成才会出现在查询结果中。</p>
    </div>}
  </div>;
}
