'use client';
import {useEffect,useState,type FormEvent} from 'react';
import type {ModelMediaConfig} from '../../packages/automation/src/model-media';

type Configuration=ModelMediaConfig&{hasImageKey:boolean;hasVideoKey:boolean;revision:string};
export function CreativeSettings(){
  const [config,setConfig]=useState<Configuration|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  async function load(){const response=await fetch('/api/v1/model-media-config',{cache:'no-store'}),body=await response.json();if(!response.ok)throw new Error(body.message);setConfig(body);}
  useEffect(()=>{void load().catch(cause=>setError(String(cause)));},[]);
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!config)return;
    const form=event.currentTarget,data=new FormData(form);setBusy(true);setError('');setNotice('');
    try{
      const imageKey=String(data.get('imageKey')||''),videoKey=String(data.get('videoKey')||'');
      const payload={revision:config.revision,config:{
        image:{enabled:data.get('imageEnabled')==='on',referenceEditing:data.get('referenceEditing')==='on',baseUrl:String(data.get('imageBase')),model:String(data.get('imageModel'))},
        video:{enabled:data.get('videoEnabled')==='on',baseUrl:data.get('videoBase'),model:data.get('videoModel')},
      },...(data.get('clearImage')?{imageKey:''}:imageKey?{imageKey}:{}),...(data.get('clearVideo')?{videoKey:''}:videoKey?{videoKey}:{})};
      const response=await fetch('/api/v1/model-media-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),body=await response.json();
      if(!response.ok)throw new Error(body.message);
      setConfig(body);form.reset();setNotice('模型配置已保存。桌面端下次调用时会使用新配置。');
    }catch(cause){setError(cause instanceof Error?cause.message:'模型配置保存失败');}
    finally{setBusy(false);}
  }
  return <section id="creative" className="settings-section spaced"><h2>独立图片与视频供应商</h2><p className="plain-note">如已启用 MiniMax 聚合连接，无需在此重复填写密钥。此处使用单独的供应商密钥；生成参数与图片尺寸由桌面 Agent 选择。Plus Token Plan 不含视频生成，不能将其密钥填作独立视频密钥。</p>
    {error&&<p role="alert" className="feedback error">{error}</p>}{notice&&<p role="status" className="feedback">{notice}</p>}
    {config&&<form onSubmit={save} key={config.revision}><h3 className="spaced">图片生成与编辑</h3><div className="form-grid spaced">
      <label className="check-field"><input type="checkbox" name="imageEnabled" defaultChecked={config.image.enabled}/>开放图片生成模型</label>
      <label className="check-field"><input type="checkbox" name="referenceEditing" defaultChecked={config.image.referenceEditing}/>开放参考图编辑能力</label>
      <label className="field">模型接口地址<input name="imageBase" type="url" required defaultValue={config.image.baseUrl}/></label>
      <label className="field">图片模型 ID<input name="imageModel" required defaultValue={config.image.model}/></label>
      <label className="field">图片 API 密钥<input type="password" name="imageKey" autoComplete="new-password" placeholder={config.hasImageKey?'已保存，留空保持':'填写图片模型密钥'}/></label>
      <label className="check-field"><input type="checkbox" name="clearImage"/>清除图片密钥</label>
    </div><h3 className="spaced">视频生成</h3><div className="form-grid spaced">
      <label className="check-field"><input type="checkbox" name="videoEnabled" defaultChecked={config.video.enabled}/>开放视频生成模型</label>
      <label className="field">模型接口地址<select name="videoBase" defaultValue={config.video.baseUrl}><option>https://api.minimax.cn/v1</option><option>https://api.minimaxi.com/v1</option><option>https://api.minimax.io/v1</option></select></label>
      <label className="field">视频模型 ID<select name="videoModel" defaultValue={config.video.model}><option>MiniMax-Hailuo-2.3</option><option>MiniMax-Hailuo-02</option><option>T2V-01-Director</option><option>T2V-01</option><option>MiniMax-H3</option><option>MiniMax-H3-Max</option></select></label>
      <label className="field">视频 API 密钥<input type="password" name="videoKey" autoComplete="new-password" placeholder={config.hasVideoKey?'已保存，留空保持':'填写视频模型密钥'}/></label>
      <label className="check-field"><input type="checkbox" name="clearVideo"/>清除视频密钥</label>
    </div><div className="actions spaced"><button type="submit" className="btn primary" disabled={busy}>保存模型供应商配置</button><span className="footnote">密钥加密保存，不会返回浏览器</span></div></form>}
  </section>;
}
