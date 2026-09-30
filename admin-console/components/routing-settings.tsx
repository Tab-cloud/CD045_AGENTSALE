'use client';
import {useEffect,useState} from 'react';
import type {PublicSettings,Routing,Settings} from '@agentsale/automation';
import type {ModelMediaConfig} from '../../packages/automation/src/model-media';

const names:Record<keyof Routing,string>={'text.generate':'文本模型','image.generate':'图片生成','image.edit':'图片编辑','audio.speech':'语音生成','video.generate':'视频生成'};
const providerName=(capability:keyof Routing,provider:string)=>provider==='minimax'?'MiniMax 聚合连接':({
  'text.generate':'独立文本接口','image.generate':'独立图片接口','image.edit':'独立图片接口',
  'audio.speech':'独立语音接口','video.generate':'独立视频接口'
} satisfies Record<keyof Routing,string>)[capability];
type MediaConfiguration=ModelMediaConfig&{hasImageKey:boolean;hasVideoKey:boolean};

export function RoutingSettings(){
  const [settings,setSettings]=useState<PublicSettings|null>(null),[routing,setRouting]=useState<Routing|null>(null);
  const [media,setMedia]=useState<MediaConfiguration|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function load(){const [settingsResponse,mediaResponse]=await Promise.all([fetch('/api/v1/admin',{cache:'no-store'}),fetch('/api/v1/model-media-config',{cache:'no-store'})]);const [body,creative]=await Promise.all([settingsResponse.json(),mediaResponse.json()]);if(!settingsResponse.ok||!mediaResponse.ok)throw new Error(body.message||creative.message);setSettings(body.settings);setRouting(body.settings.routing);setMedia(creative);}
  function configured(capability:keyof Routing,provider:string){
    if(!settings||!media)return false;
    if(provider==='minimax')return capability!=='image.edit'&&settings.minimax.aggregate&&settings.hasAggregateKey&&(capability!=='video.generate'||settings.minimax.videoEnabled)&&(capability!=='audio.speech'||settings.minimax.enabled);
    switch(capability){
      case 'text.generate':return !!settings.model&&(settings.hasApiKey||settings.localModel);
      case 'image.generate':return media.image.enabled&&media.hasImageKey;
      case 'image.edit':return media.image.enabled&&media.image.referenceEditing&&media.hasImageKey;
      case 'video.generate':return media.video.enabled&&media.hasVideoKey;
      case 'audio.speech':return settings.independentAudioEnabled&&settings.hasMinimaxKey;
    }
  }
  useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
  function move(capability:keyof Routing,index:number,direction:-1|1){
    if(!routing)return;
    const next=[...routing[capability]],other=index+direction;if(other<0||other>=next.length)return;
    [next[index],next[other]]=[next[other],next[index]];
    setRouting({...routing,[capability]:next} as Routing);
  }
  async function save(){
    if(!settings||!routing)return;
    setBusy(true);setError('');setNotice('');
    try{
      const {hasApiKey:_,hasMinimaxKey:__,hasAggregateKey:___,verifiedAt:____,revision:_____,...stored}=settings;
      const response=await fetch('/api/v1/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',revision:settings.revision,settings:{...stored,routing} as Settings})});
      const body=await response.json();if(!response.ok)throw new Error(body.message);
      setNotice('服务顺序已保存；新请求按此顺序选择可用连接。');await load();
    }catch(e){setError(e instanceof Error?e.message:'保存服务顺序失败');}finally{setBusy(false);}
  }
  return <div className="admin-panel">
    <div className="sectionrow"><h2>桌面 Agent 服务顺序</h2></div>
    <p className="muted small">每种能力独立排序，目前可排列独立接口与 MiniMax 聚合连接。桌面端优先使用第一项；未配置或明确拒绝受理时尝试下一项。供应商服务端错误、超时或结果未知时只续查原编号，避免重复生成与计费。</p>
    {error&&<p role="alert" className="feedback error">{error}</p>}{notice&&<p role="status" className="feedback">{notice}</p>}
    {routing&&<>{(Object.keys(names) as (keyof Routing)[]).map(capability=><section key={capability} className="spaced"><h3>{names[capability]}</h3><div className="routing-list">{routing[capability].map((provider,index)=><div key={provider} className="routing-row"><span>{index+1}. {providerName(capability,provider)} <small className={configured(capability,provider)?'routing-ready':'routing-missing'}>{configured(capability,provider)?'已配置':'未配置，运行时跳过'}</small></span><div className="actions"><button className="btn" type="button" disabled={busy||index===0} onClick={()=>move(capability,index,-1)} aria-label={`${names[capability]}：${providerName(capability,provider)}上移`}>上移</button><button className="btn" type="button" disabled={busy||index===routing[capability].length-1} onClick={()=>move(capability,index,1)} aria-label={`${names[capability]}：${providerName(capability,provider)}下移`}>下移</button></div></div>)}</div></section>)}<div className="actions spaced"><button className="btn primary" type="button" disabled={busy} onClick={()=>void save()}>保存服务顺序</button></div></>}
  </div>;
}
