'use client';
import {useEffect,useState,type FormEvent} from 'react';
import type {PublicSettings,Settings} from '@agentsale/automation';
import {minimaxVideoAllowed} from '../../packages/automation/src/types';
import {VoicePicker} from './voice-picker';
import {SpeechTest} from './speech-test';

type AdminData={settings:PublicSettings};
type PlanType=Settings['minimax']['planType'];
type VideoModel=Settings['minimax']['videoModel'];

export function MiniMaxPanel(){
  const [data,setData]=useState<AdminData|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [enabled,setEnabled]=useState(false),[planType,setPlanType]=useState<PlanType>('unspecified'),[videoModel,setVideoModel]=useState<VideoModel>('MiniMax-Hailuo-2.3'),[videoEnabled,setVideoEnabled]=useState(false),[voicesText,setVoicesText]=useState('');
  async function load(resetForm=false){
    const response=await fetch('/api/v1/admin',{cache:'no-store'}),body=await response.json();
    if(!response.ok)throw new Error(body.message);
    setData(body);if(resetForm){setEnabled(body.settings.minimax.aggregate);setPlanType(body.settings.minimax.planType);setVideoModel(body.settings.minimax.videoModel);setVideoEnabled(body.settings.minimax.videoEnabled);setVoicesText(body.settings.minimax.voices.map((voice:{id:string;name:string})=>voice.id+' | '+voice.name).join('\n'));}
  }
  useEffect(()=>{void load(true).catch(e=>setError(e.message));},[]);
  async function post(body:unknown){
    setBusy(true);setError('');setNotice('');
    try{const response=await fetch('/api/v1/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json();if(!response.ok)throw new Error(result.message);setNotice(result.message);await load(Boolean(result.settings));}
    catch(e){setError(e instanceof Error?e.message:'管理操作失败');}
    finally{setBusy(false);}
  }
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!data)return;
    const form=new FormData(event.currentTarget),{hasApiKey:_,hasMinimaxKey:__,hasAggregateKey:___,verifiedAt:____,revision:_____,...stored}=data.settings;
    const aggregate=form.get('aggregate')==='on',baseUrl=String(form.get('minimaxBaseUrl')) as Settings['minimax']['baseUrl'];
    const voices=String(form.get('voices')||'').split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{const [id,name]=line.split('|').map(part=>part.trim());return {id,name:name||id};});
    const settings:Settings=aggregate?{...stored,minimax:{...stored.minimax,baseUrl,textModel:String(form.get('textModel')||'').trim(),speechModel:String(form.get('speechModel')||'').trim(),voices,enabled:true,aggregate:true,planType:form.get('planType') as PlanType,imageModel:String(form.get('imageModel')||'').trim(),videoModel:form.get('videoModel') as VideoModel,videoEnabled:form.get('videoEnabled')==='on'}}:{...stored,minimax:{...stored.minimax,aggregate:false,enabled:false,videoEnabled:false}};
    const apiKey=String(form.get('aggregateKey')||'');
    await post({action:'save',revision:data.settings.revision,settings,...(apiKey?{aggregateKey:apiKey}:{})});
  }
  const canEnableVideo=minimaxVideoAllowed(planType,videoModel);
  return <div className="admin-panel">{error&&<p role="alert" className="feedback error">{error}</p>}{notice&&<p role="status" className="feedback">{notice}</p>}
    <section className="minimax-capabilities" aria-labelledby="minimax-capability-title">
      <div className="sectionrow"><h2 id="minimax-capability-title">Token Plan 能力边界</h2><a href="https://platform.minimax.io/subscribe/token-plan" target="_blank" rel="noopener noreferrer" className="small">查看官方套餐说明 ↗</a></div>
      <p className="muted small">以 Plus 档为基准区分供应商权益和聆风接入状态。填写密钥不会自动开通未购买的能力；面向多用户的正式服务宜使用供应商许可的生产 API。</p>
      <div className="minimax-capability-grid">
        <div className="minimax-capability-card"><h3>Plus 包含 · 已接入</h3><ul><li>文本生成：当前默认 MiniMax-M3</li><li>图片生成：image-01</li><li>语音合成：桌面 Agent 从音色列表选择</li></ul></div>
        <div className="minimax-capability-card"><h3>套餐支持或提供接口 · 待接入</h3><ul><li>图像／视频输入理解：Plus 包含，桌面多模态请求尚未接入</li><li>参考图编辑：MiniMax 接口需要可访问的图片地址，本地图片流程尚未接入</li></ul></div>
        <div className="minimax-capability-card unavailable"><h3>Plus 不包含 · 单独开放</h3><ul><li>视频生成：Plus 不含；Max／Ultra 仅列出限额的 Hailuo 2.3，H3 需按量付费</li><li>音乐生成：2026 年 8 月 20 日起退出 Token Plan，聆风暂未接入</li></ul></div>
      </div>
    </section>
    {data&&<form id="minimax" key={data.settings.revision} onSubmit={save}>
      <div className="sectionrow"><h2>MiniMax 聚合连接</h2><span className="status">{data.settings.minimax.aggregate&&data.settings.hasAggregateKey?'已配置':'未启用'}</span></div>
      <p className="muted small">使用一个官方接口地址和一把授权密钥，按已接入的模型能力转发。密钥明文不会返回浏览器；视频需按实际密钥权益单独开放。</p>
      <div className="form-grid spaced">
        <label className="check-field"><input name="aggregate" type="checkbox" checked={enabled} onChange={event=>{setEnabled(event.currentTarget.checked);if(!event.currentTarget.checked)setVideoEnabled(false);}}/>启用 MiniMax 聚合连接</label>
        {enabled&&<><label className="field">密钥类型<select name="planType" value={planType} onChange={event=>{const next=event.currentTarget.value as PlanType;setPlanType(next);if(!minimaxVideoAllowed(next,videoModel))setVideoEnabled(false);}}><option value="unspecified">尚未确认</option><option value="plus">Token Plan · Plus</option><option value="max">Token Plan · Max</option><option value="ultra">Token Plan · Ultra</option><option value="payg">按量付费 API</option></select></label>
        <label className="field">MiniMax 接口地址<select name="minimaxBaseUrl" defaultValue={data.settings.minimax.baseUrl}><option>https://api.minimax.cn/v1</option><option>https://api.minimaxi.com/v1</option><option>https://api.minimax.io/v1</option></select></label>
        <label className="field">聚合 API 密钥<input name="aggregateKey" type="password" autoComplete="new-password" placeholder={data.settings.hasAggregateKey?'已保存，留空保持':'填写已获授权的 API Key'}/></label>
        <label className="field">文本模型 ID<input name="textModel" required maxLength={100} defaultValue={data.settings.minimax.textModel}/></label>
        <label className="field">语音模型 ID<input name="speechModel" required maxLength={100} defaultValue={data.settings.minimax.speechModel}/></label>
        <label className="field">图片模型 ID<input name="imageModel" required maxLength={100} defaultValue={data.settings.minimax.imageModel}/></label>
        <label className="field">视频模型 ID<select name="videoModel" value={videoModel} onChange={event=>{const next=event.currentTarget.value as VideoModel;setVideoModel(next);if(!minimaxVideoAllowed(planType,next))setVideoEnabled(false);}}><option>MiniMax-Hailuo-2.3</option><option>MiniMax-Hailuo-02</option><option>T2V-01-Director</option><option>T2V-01</option><option>MiniMax-H3</option><option>MiniMax-H3-Max</option></select></label>
        <label className="check-field"><input name="videoEnabled" type="checkbox" disabled={!enabled||!canEnableVideo} checked={videoEnabled&&enabled&&canEnableVideo} onChange={event=>setVideoEnabled(event.currentTarget.checked)}/>已确认该密钥具有所选视频模型权限，向会员开放</label>
        <VoicePicker providerId="minimax" hasSavedKey={data.settings.hasAggregateKey} value={voicesText} onChange={setVoicesText} disabled={busy}/>
        </>}
      </div>
      <p className="footnote">Plus 和未确认密钥类型不能开放视频。Max／Ultra 仅可开放 Hailuo 2.3；H3 等模型需按量付费密钥。音色列表由普通连接和聚合连接共用，所选音色应在实际使用的密钥下可用；桌面调用顺序在“服务路由”设置。</p>
      <SpeechTest providerId="minimax" settings={data.settings} disabled={busy}/>
      <div className="actions spaced"><button className="btn primary" disabled={busy}>保存 MiniMax 配置</button>{enabled&&<button className="btn" type="button" disabled={busy} onClick={()=>post({action:'verify',providerId:'minimax'})}>测试 MiniMax 文本连接</button>}</div>
    </form>}
  </div>;
}
