import {useEffect,useState} from 'react';
import type {PublicSettings} from '@agentsale/automation';
import {decodeSpeechAudio} from './speech-test-audio';

type ProviderId='standard'|'minimax';

export function SpeechTest({providerId,settings,disabled=false}:{providerId:ProviderId;settings:PublicSettings;disabled?:boolean}){
  const [voiceId,setVoiceId]=useState(settings.minimax.voices[0]?.id||'');
  const [text,setText]=useState('你好，聆风语音测试成功。');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[audioUrl,setAudioUrl]=useState<string|null>(null);
  useEffect(()=>()=>{if(audioUrl)URL.revokeObjectURL(audioUrl);},[audioUrl]);
  const ready=providerId==='standard'?settings.independentAudioEnabled&&settings.hasMinimaxKey:settings.minimax.aggregate&&settings.minimax.enabled&&settings.hasAggregateKey;

  async function run(){
    setBusy(true);setError('');setAudioUrl(null);
    try{
      const response=await fetch('/api/v1/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'testSpeech',providerId,voiceId,text:text.trim()})});
      const payload:unknown=await response.json();
      if(!response.ok){const message=payload&&typeof payload==='object'&&'message' in payload?(payload as {message:unknown}).message:null;throw new Error(typeof message==='string'?message:'试听请求失败');}
      const bytes=decodeSpeechAudio(payload);
      setAudioUrl(URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer],{type:'audio/mpeg'})));
    }catch(cause){setError(cause instanceof Error?cause.message:'试听请求失败');}
    finally{setBusy(false);}
  }

  return <section className="speech-test" aria-label={providerId==='standard'?'独立音频试听':'MiniMax 聚合音频试听'}>
    <div className="sectionrow"><h3>测试音频</h3><span className="muted small">使用已保存的连接和音色</span></div>
    <p className="muted small">试听不扣会员额度，可能消耗供应商额度。修改模型、密钥或音色后请先保存。</p>
    <div className="speech-test-controls">
      <label className="field">试听音色<select value={voiceId} onChange={event=>{setVoiceId(event.currentTarget.value);setAudioUrl(null);}} disabled={busy||disabled}>
        {settings.minimax.voices.map(voice=><option key={voice.id} value={voice.id}>{voice.name} · {voice.id}</option>)}
      </select></label>
      <label className="field">试听文案<input value={text} maxLength={200} onChange={event=>{setText(event.currentTarget.value);setAudioUrl(null);}} disabled={busy||disabled}/></label>
    </div>
    <div className="actions spaced"><button className="btn" type="button" disabled={busy||disabled||!ready||!voiceId||!text.trim()} onClick={()=>void run()}>{busy?'正在生成…':'生成测试音频'}</button>{!ready&&<span className="muted small">请先启用并保存此音频连接和密钥。</span>}</div>
    {error&&<p className="feedback error" role="alert">{error}</p>}
    {audioUrl&&<div className="speech-test-result"><span role="status">生成成功，可播放试听</span><audio controls preload="metadata" src={audioUrl}>浏览器不支持音频播放。</audio></div>}
  </section>;
}
