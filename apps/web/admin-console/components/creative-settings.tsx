'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CreativeConfig } from '../../packages/automation/src/creative';
type Configuration = CreativeConfig & { hasImageKey: boolean; hasVideoKey: boolean };
export function CreativeSettings() {
  const [config,setConfig]=useState<Configuration|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const located=useRef(false);
  useEffect(()=>{if(config&&!located.current){located.current=true;if(window.location.hash==='#creative')document.getElementById('creative')?.scrollIntoView();}},[config]);
  useEffect(()=>{void fetch('/api/v1/creative-config',{cache:'no-store'}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.message);setConfig(body);}).catch(e=>setError(e.message));},[]);
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault(); const data=new FormData(event.currentTarget),form=event.currentTarget;
    setBusy(true);setError('');setNotice('');
    try {
      const imageKey=String(data.get('imageKey')||''),videoKey=String(data.get('videoKey')||'');
      const response=await fetch('/api/v1/creative-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        config:{editing:{enabled:data.get('editingEnabled')==='on'},image:{enabled:data.get('imageEnabled')==='on',referenceEditing:data.get('referenceEditing')==='on',baseUrl:String(data.get('imageBase')),model:String(data.get('imageModel')),size:data.get('imageSize')},video:{enabled:data.get('videoEnabled')==='on',baseUrl:data.get('videoBase'),model:data.get('videoModel'),duration:6,resolution:'768P'},avatar:{enabled:data.get('avatarEnabled')==='on',meloPythonPath:String(data.get('meloPython')||''),sadTalkerPythonPath:String(data.get('sadTalkerPython')||''),sadTalkerPath:String(data.get('sadTalkerPath')||'')}},
        ...(data.get('clearImage')?{imageKey:''}:imageKey?{imageKey}:{}),...(data.get('clearVideo')?{videoKey:''}:videoKey?{videoKey}:{})
      })});
      const body=await response.json();if(!response.ok)throw new Error(body.message);
      setConfig(body);form.reset();setNotice('已保存。聆风下次创作时会读取新配置，无需将密钥填入桌面端。');
    }catch(e){setError(e instanceof Error?e.message:'配置保存失败');}finally{setBusy(false);}
  }
  return <section id="creative" className="settings-section spaced"><h2>聆风图片与视频创作</h2><p className="plain-note">在桌面端描述创作目标，Agent 会规划风格、画面和分镜，再调用已启用的服务。启用后，创作任务会产生服务商费用；每个任务最多生成 4 个作品，不会自动重复提交失败的请求。</p>
    {error&&<p role="alert" className="feedback error">{error}</p>}{notice&&<p role="status" className="feedback">{notice}</p>}
    {config&&<form onSubmit={save} key={JSON.stringify(config)}><h3 className="spaced">图片生成 · OpenAI 兼容协议</h3><div className="form-grid spaced">
      <label className="check-field"><input type="checkbox" name="imageEnabled" defaultChecked={config.image.enabled}/>允许 Agent 生成图片</label>
      <label className="check-field"><input type="checkbox" name="referenceEditing" defaultChecked={config.image.referenceEditing}/>支持商品参考图生成（图片编辑接口）</label>
      <label className="field">接口地址<input name="imageBase" type="url" required defaultValue={config.image.baseUrl}/></label>
      <label className="field">图片模型<input name="imageModel" required defaultValue={config.image.model}/></label>
      <label className="field">输出尺寸<select name="imageSize" defaultValue={config.image.size}><option>1024x1024</option><option>1536x1024</option><option>1024x1536</option><option value="auto">模型自动选择</option></select></label>
      <label className="field">图片 API 密钥<input type="password" name="imageKey" autoComplete="new-password" placeholder={config.hasImageKey?'已保存，留空保持':'填写图片服务密钥'}/></label>
      <label className="check-field"><input type="checkbox" name="clearImage"/>清除图片密钥（需同时关闭服务）</label>
    </div><h3 className="spaced">视频剪辑 · 平台渲染</h3><label className="check-field"><input type="checkbox" name="editingEnabled" defaultChecked={config.editing.enabled}/>启用视频截取、画幅调整与静音导出</label><p className="plain-note">服务端需安装 FFmpeg 和 FFprobe，剪辑占用会员视频次数，不需要额外 AI 视频密钥。单份素材最大 20 MB、最长 3 分钟，每次导出最长 60 秒。</p><h3 className="spaced">视频生成 · MiniMax 文生视频</h3><div className="form-grid spaced">
      <label className="check-field"><input type="checkbox" name="videoEnabled" defaultChecked={config.video.enabled}/>允许 Agent 生成视频</label>
      <label className="field">服务地址<select name="videoBase" defaultValue={config.video.baseUrl}><option>https://api.minimax.cn/v1</option><option>https://api.minimaxi.com/v1</option><option>https://api.minimax.io/v1</option></select></label>
      <label className="field">视频模型<select name="videoModel" defaultValue={config.video.model}><option>MiniMax-Hailuo-2.3</option><option>MiniMax-Hailuo-02</option></select></label>
      <label className="field">视频 API 密钥<input type="password" name="videoKey" autoComplete="new-password" placeholder={config.hasVideoKey?'已保存，留空保持':'填写视频服务密钥'}/></label>
      <label className="check-field"><input type="checkbox" name="clearVideo"/>清除视频密钥（需同时关闭服务）</label>
    </div><h3 className="spaced">数字人口播 · 本地开源模型</h3><div className="form-grid spaced"><label className="check-field"><input type="checkbox" name="avatarEnabled" defaultChecked={config.avatar.enabled}/>允许会员生成数字人口播视频</label><label className="field">MeloTTS Python 绝对路径<input name="meloPython" defaultValue={config.avatar.meloPythonPath} placeholder="/opt/melo/bin/python"/></label><label className="field">SadTalker Python 绝对路径<input name="sadTalkerPython" defaultValue={config.avatar.sadTalkerPythonPath} placeholder="/opt/sadtalker/bin/python"/></label><label className="field">SadTalker 仓库绝对路径<input name="sadTalkerPath" defaultValue={config.avatar.sadTalkerPath} placeholder="/opt/lingfeng-avatar/SadTalker"/></label></div><p className="plain-note">Web 服务本机需安装 MeloTTS 中文配音、SadTalker 和模型权重。会员在桌面端上传已获授权的人像照片；脚本、配音和视频在平台本机生成，无需数字人付费 API。实际生成需要服务器算力，请核对肖像授权、配音和成片。</p><p className="plain-note">电商商品图通过 /images/edits 上传参考图片；仅在服务商支持该接口时启用。普通视频每段为 6 秒、768P；数字人口播使用本地模型。更换付费服务地址会清除旧密钥；保存本地模型路径不代表已验证实际生成。</p><div className="actions spaced"><button type="submit" className="btn primary" disabled={busy}>保存创作服务</button><span className="footnote">密钥加密保存，仅返回是否已配置</span></div></form>}
  </section>;
}
