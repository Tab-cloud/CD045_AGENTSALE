'use client';
import {useEffect,useState} from 'react';
import {platformRequest} from '../../console/components/platform-account';
import {PaymentEditor,type PaymentConfiguration} from './payment-editor';

type Feature='model'|'image'|'video'|'audio';
type Plan={id:string;name:string;priceCents:number;days:number;published:boolean;limits:Record<Feature,number>};
type PlanDraft={id:string;name:string;price:string;days:string;published:boolean;limits:Record<Feature,string>};
type Data={plans:Plan[];payment:PaymentConfiguration};
const initial:Plan={id:'standard',name:'聆风会员',priceCents:0,days:30,published:false,limits:{model:40,image:5,video:2,audio:0}};
const features=[['model','文本模型调用'],['image','图片生成'],['video','视频生成'],['audio','音频模型调用']] as const;
const editPlan=(plan:Plan):PlanDraft=>({...plan,price:String(plan.priceCents/100),days:String(plan.days),limits:{model:String(plan.limits.model),image:String(plan.limits.image),video:String(plan.limits.video),audio:String(plan.limits.audio??0)}});

function validatedPlan(draft:PlanDraft):Plan{
  const price=Number(draft.price),days=Number(draft.days);
  if(!/^\d+(?:\.\d{1,2})?$/.test(draft.price)||price<0.01||price>10000)throw new Error('价格需为 0.01–10000 元，最多两位小数');
  if(!/^[1-9]\d*$/.test(draft.days)||!Number.isSafeInteger(days)||days>366)throw new Error('有效天数需为 1–366 天');
  const limits={} as Record<Feature,number>;
  for(const [feature,label] of features){
    const raw=draft.limits[feature],value=Number(raw);
    if(!/^(?:-1|0|[1-9]\d*)$/.test(raw)||!Number.isSafeInteger(value))throw new Error(`${label}每日额度需为 -1 或非负整数`);
    limits[feature]=value;
  }
  return {id:draft.id,name:draft.name,priceCents:Math.round(price*100),days,published:draft.published,limits};
}

export function BillingSettings(){
  const [data,setData]=useState<Data|null>(null),[draft,setDraft]=useState<PlanDraft>(()=>editPlan(initial)),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const savedPlan=data?.plans.some(plan=>plan.id===draft.id)??false;
  function selectPlan(plan:Plan){setDraft(editPlan(plan));setError('');setMessage('');}
  async function refresh(preferredId?:string){const next=await platformRequest('membership-admin') as Data;setData(next);selectPlan(next.plans.find(plan=>plan.id===preferredId)??next.plans[0]??initial);}
  useEffect(()=>{void refresh(initial.id).catch(cause=>setError(cause instanceof Error?cause.message:'套餐加载失败'));},[]);
  async function save(){setBusy(true);setMessage('');setError('');try{const plan=validatedPlan(draft);await platformRequest('membership-admin',{action:'plan',plan});await refresh(plan.id);setMessage('套餐已保存');}catch(cause){setError(cause instanceof Error?cause.message:'套餐保存失败');}finally{setBusy(false);}}

  return <section id="membership" className="billing-admin">
    <h2>会员套餐与支付</h2>
    <p>用户通过微信 / 支付宝购买有效期套餐。仅在服务端核验支付成功后自动开通，不自动扣款。</p>
    {error&&<p className="account-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <details open><summary>套餐管理</summary>
      <div>{data?.plans.map(plan=><button type="button" key={plan.id} aria-pressed={draft.id===plan.id} onClick={()=>selectPlan(plan)}>{plan.name}{plan.published?' · 已发布':' · 草稿'}</button>)}<button type="button" onClick={()=>selectPlan({...initial,id:'plan-'+Date.now()})}>新增套餐</button></div>
      <form onSubmit={event=>{event.preventDefault();void save();}}>
        <div className="billing-grid">
          <label>套餐标识<input required readOnly={savedPlan} value={draft.id} pattern="[A-Za-z0-9_-]{1,40}" title="1–40 位英文字母、数字、下划线或短横线" onChange={event=>setDraft({...draft,id:event.target.value})}/><small>{savedPlan?'已保存套餐的标识不可修改；如需新的标识，请新增套餐。':'支持 1–40 位英文字母、数字、下划线或短横线。'}</small></label>
          <label>套餐名称<input required maxLength={80} value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label>
          <label>价格（元）<input type="number" min="0.01" max="10000" step="0.01" required value={draft.price} onChange={event=>setDraft({...draft,price:event.target.value})}/></label>
          <label>有效天数<input type="number" min={1} max={366} step={1} required value={draft.days} onChange={event=>setDraft({...draft,days:event.target.value})}/></label>
          {features.map(([feature,label])=><label key={feature}>{label}每日额度（-1 不限，0 不包含）<input type="text" inputMode="text" pattern="-1|0|[1-9][0-9]*" title="填写 -1 表示不限，或填写非负整数" required value={draft.limits[feature]} onChange={event=>setDraft({...draft,limits:{...draft.limits,[feature]:event.target.value}})}/></label>)}
        </div>
        <label><input type="checkbox" checked={draft.published} onChange={event=>setDraft({...draft,published:event.target.checked})}/>发布到会员中心</label>
        <p>价格和权益会保存到订单中。修改套餐不追溯已购买权益；网页搜索、正文读取与本地知识库检索由桌面端执行，不占用模型额度；额度按 UTC 日期重置；-1 表示不限次数，但仍记录调用量。失败或未确认提交也计入。</p>
        <button className="account-primary" disabled={busy}>{busy?'保存中…':'保存套餐'}</button>
      </form>
    </details>
    {data&&<PaymentEditor initial={data.payment}/>}
  </section>;
}
