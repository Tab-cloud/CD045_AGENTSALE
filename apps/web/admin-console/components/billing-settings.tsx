'use client';
import {useEffect,useState} from 'react';
import {platformRequest} from '../../console/components/platform-account';
import {PaymentEditor,type PaymentConfiguration} from './payment-editor';

type Plan={id:string;name:string;priceCents:number;days:number;published:boolean;limits:{model:number;search:number;image:number;video:number}};
type Data={plans:Plan[];payment:PaymentConfiguration};
const initial:Plan={id:'standard',name:'聆风会员',priceCents:0,days:30,published:false,limits:{model:40,search:20,image:5,video:2}};
const features=[['model','模型调用'],['search','网页与知识库检索'],['image','图片生成'],['video','视频生成']] as const;

export function BillingSettings(){
  const [data,setData]=useState<Data|null>(null),[plan,setPlan]=useState<Plan>(initial),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const savedPlan=data?.plans.some(p=>p.id===plan.id)??false;
  async function refresh(){const next=await platformRequest('membership-admin') as Data;setData(next);setPlan(current=>next.plans.find(p=>p.id===current.id)??next.plans[0]??current);}
  useEffect(()=>{void refresh().catch(e=>setError(e.message));},[]);
  async function save(){setBusy(true);setMessage('');setError('');try{await platformRequest('membership-admin',{action:'plan',plan});await refresh();setMessage('套餐已保存');}catch(cause){setError(cause instanceof Error?cause.message:'套餐保存失败');}finally{setBusy(false);}}

  return <section id="membership" className="billing-admin">
    <h2>会员套餐与支付</h2>
    <p>用户通过微信 / 支付宝购买有效期套餐。仅在服务端核验支付成功后自动开通，不自动扣款。</p>
    {error&&<p className="account-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <details open><summary>套餐管理</summary>
      <div>{data?.plans.map(p=><button type="button" key={p.id} aria-pressed={plan.id===p.id} onClick={()=>{setPlan(p);setError('');setMessage('');}}>{p.name}{p.published?' · 已发布':' · 草稿'}</button>)}<button type="button" onClick={()=>{setPlan({...initial,id:'plan-'+Date.now()});setError('');setMessage('');}}>新增套餐</button></div>
      <form onSubmit={event=>{event.preventDefault();void save();}}>
        <div className="billing-grid">
          <label>套餐标识<input required readOnly={savedPlan} value={plan.id} pattern="[A-Za-z0-9_-]{1,40}" title="1–40 位英文字母、数字、下划线或短横线" onChange={event=>setPlan({...plan,id:event.target.value})}/><small>{savedPlan?'已保存套餐的标识不可修改；如需新的标识，请新增套餐。':'支持 1–40 位英文字母、数字、下划线或短横线。'}</small></label>
          <label>套餐名称<input required maxLength={80} value={plan.name} onChange={event=>setPlan({...plan,name:event.target.value})}/></label>
          <label>价格（元）<input type="number" min="0.01" max="10000" step="0.01" required value={plan.priceCents/100} onChange={event=>setPlan({...plan,priceCents:Math.round(Number(event.target.value)*100)})}/></label>
          <label>有效天数<input type="number" min={1} max={366} step={1} required value={plan.days} onChange={event=>setPlan({...plan,days:Number(event.target.value)})}/></label>
          {features.map(([feature,label])=><label key={feature}>{label}每日额度（-1 不限，0 不包含）<input type="number" min={-1} step={1} required value={plan.limits[feature]} onChange={event=>setPlan({...plan,limits:{...plan.limits,[feature]:Number(event.target.value)}})}/></label>)}
        </div>
        <label><input type="checkbox" checked={plan.published} onChange={event=>setPlan({...plan,published:event.target.checked})}/>发布到会员中心</label>
        <p>价格和权益会保存到订单中。修改套餐不追溯已购买权益；每次网页搜索、正文读取或知识库检索各计 1 次检索额度；额度按 UTC 日期重置；-1 表示不限次数，但仍记录调用量。失败或未确认提交也计入。</p>
        <button className="account-primary" disabled={busy}>{busy?'保存中…':'保存套餐'}</button>
      </form>
    </details>
    {data&&<PaymentEditor initial={data.payment}/>}
  </section>;
}
