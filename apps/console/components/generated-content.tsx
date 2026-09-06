'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import type { Job } from '@agentsale/automation';
export function GeneratedContent(){
  const [jobs,setJobs]=useState<Job[]>([]),[error,setError]=useState('');
  useEffect(()=>{const load=async()=>{try{const response=await fetch('/api/v1/automation',{cache:'no-store'}),body=await response.json();if(!response.ok)throw new Error(body.message);setJobs(body.jobs.filter((j:Job)=>!!j.copy));}catch(e){setError(e instanceof Error?e.message:'无法读取内容');}};void load();const timer=setInterval(load,3000);return()=>clearInterval(timer);},[]);
  return <section className="generated-content"><div className="sectionrow"><h2>自动化产物</h2><Link href="/automation" className="btn primary">生成商品内容包</Link></div>{error&&<p role="alert" className="form-error">{error}</p>}{jobs.length?<div className="generated-grid">{jobs.map(j=><article key={j.id}>{j.artifacts.some(a=>a.name==='video.mp4')?<video controls preload="metadata" src={'/api/v1/files?job='+j.id+'&name=video.mp4'}/>:<div className="plain-note">营销文案已生成，视频尚未完成</div>}<div className="content-badges">{j.copy?.listing&&<span className="status">电商详情</span>}{j.artifacts.some(a=>a.name.startsWith('poster-'))&&<span className="status">三尺寸海报</span>}{j.input.voiceover&&<span className="status">配音</span>}</div><h3>{j.copy?.title}</h3><p className="preserve small">{j.copy?.caption}</p><p className="footnote">{j.kind==='render'?'人工文案 / 自动编码':'模型生成 / 待核实'} · {j.state==='succeeded'?'已内部审阅':'待处理或审阅'}</p><Link className="inline-link" href={'/automation/jobs/'+j.id}>查看海报、详情文案和视频</Link></article>)}</div>:<p className="plain-note">尚无自动化内容。配置模型后可从供货资料生成营销文案，提供授权图片后输出视频。</p>}</section>;
}
