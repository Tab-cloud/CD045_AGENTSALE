'use client';
import {Fragment,useEffect,useState,type FormEvent} from 'react';
import {platformRequest} from '../../console/components/platform-account';

type Plan={id:string;name:string;days:number;published:boolean};
type Member={id:string;username:string;phone:string|null;wechatBound:boolean;role:string;enabled:boolean;subscription:{active:boolean;membership:{plan:{id:string;name:string};expiresAt:string;status:'active'|'revoked'}|null}};
type Page={page:number;pageSize:number;total:number;users:Member[]};
const localDateTime=(value:string)=>{const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const afterDays=(days:number)=>localDateTime(new Date(Date.now()+days*86400000).toISOString());

export function MemberUsers(){
  const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1),[data,setData]=useState<Page|null>(null);
  const [plans,setPlans]=useState<Plan[]>([]),[plansLoaded,setPlansLoaded]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [editingId,setEditingId]=useState<string|null>(null),[planId,setPlanId]=useState(''),[expiresAt,setExpiresAt]=useState(''),[reason,setReason]=useState('');
  async function load(){const result=await platformRequest(`membership-admin?scope=users&page=${page}&q=${encodeURIComponent(search)}`) as Page;setData(result);setError('');}
  useEffect(()=>{void load().catch(reason=>setError(reason instanceof Error?reason.message:'用户列表加载失败'));},[page,search]);
  useEffect(()=>{void platformRequest('membership-admin?scope=plans').then(result=>setPlans((result as {plans:Plan[]}).plans)).catch(reason=>setError(reason instanceof Error?reason.message:'会员套餐加载失败')).finally(()=>setPlansLoaded(true));},[]);
  function submit(event:FormEvent){event.preventDefault();setEditingId(null);setPage(1);setSearch(query.trim());}
  function edit(user:Member){
    if(editingId===user.id){setEditingId(null);return;}
    const current=user.subscription.membership;
    setPlanId(current?.plan.id??plans[0]?.id??'');
    setExpiresAt(current&&Date.parse(current.expiresAt)>Date.now()?localDateTime(current.expiresAt):afterDays(plans.find(plan=>plan.id===(current?.plan.id??plans[0]?.id))?.days??30));
    setReason('');setEditingId(user.id);setError('');setNotice('');
  }
  async function saveMembership(event:FormEvent,userId:string){
    event.preventDefault();
    const expiry=new Date(expiresAt);
    if(!planId||!Number.isFinite(expiry.getTime())||expiry.getTime()<=Date.now()){setError('请选择套餐，并填写晚于当前时间的到期时间');return;}
    setBusy(true);setError('');setNotice('');
    try{await platformRequest('membership-admin',{action:'setMembership',userId,planId,expiresAt:expiry.toISOString(),reason:reason.trim()});await load();setEditingId(null);setNotice('会员套餐与到期时间已更新');}
    catch(cause){setError(cause instanceof Error?cause.message:'会员设置失败');}
    finally{setBusy(false);}
  }
  async function action(kind:'revoke'|'disable'|'enable',userId:string){if(!window.confirm(kind==='revoke'?'撤销该账号的会员服务权限？':kind==='disable'?'停用该账号并撤销登录状态？':'重新启用该账号？'))return;setBusy(true);setError('');setNotice('');try{await platformRequest('membership-admin',{action:kind,userId});await load();setEditingId(null);setNotice(kind==='revoke'?'会员权限已撤销':kind==='disable'?'账号已停用':'账号已启用');}catch(reason){setError(reason instanceof Error?reason.message:'操作失败');}finally{setBusy(false);}}
  const lastPage=Math.max(1,Math.ceil((data?.total||0)/(data?.pageSize||20)));
  return <section id="users" className="billing-admin"><h2>用户与会员</h2><p>查看注册账号，手动开通或调整会员套餐和到期时间。人工调整会记录原因，不生成付款订单。</p>
    <form className="member-search" onSubmit={submit}><label>搜索账号或手机号<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="输入用户名或手机号" maxLength={100}/></label><button type="submit">搜索</button></form>
    {error&&<p className="account-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!data&&!error?<p>正在加载用户…</p>:<><p>共 {data?.total||0} 个账号 · 第 {page} / {lastPage} 页</p><div className="table-wrap"><table><thead><tr><th>账号</th><th>手机号</th><th>微信</th><th>会员</th><th>到期时间</th><th>管理</th></tr></thead><tbody>{data?.users.map(user=><Fragment key={user.id}><tr><td>{user.username} · {user.role==='admin'?'管理员':'用户'}{!user.enabled&&'（已停用）'}</td><td>{user.phone||'未绑定'}</td><td>{user.wechatBound?'已绑定':'未绑定'}</td><td>{user.subscription.active?user.subscription.membership?.plan.name:user.subscription.membership?.status==='revoked'?'已撤销':'未开通 / 已到期'}</td><td>{user.subscription.membership?new Date(user.subscription.membership.expiresAt).toLocaleString('zh-CN'):'—'}</td><td><button type="button" disabled={busy||!user.enabled||!plansLoaded} aria-expanded={editingId===user.id} onClick={()=>edit(user)}>{editingId===user.id?'收起设置':'设置会员'}</button><button type="button" disabled={busy||!user.subscription.active} onClick={()=>void action('revoke',user.id)}>撤销会员</button><button type="button" disabled={busy} onClick={()=>void action(user.enabled?'disable':'enable',user.id)}>{user.enabled?'停用账号':'重新启用'}</button></td></tr>
      {editingId===user.id&&<tr className="member-editor-row"><td colSpan={6}><form className="member-editor" onSubmit={event=>void saveMembership(event,user.id)}><div><h3>设置 {user.username} 的会员</h3><p>选择套餐并指定到期时间。后续付费续费会从当前有效到期时间顺延。</p></div><div className="member-editor-fields"><label>会员套餐<select required value={planId} onChange={event=>setPlanId(event.target.value)} disabled={!plansLoaded||plans.length===0}>{plans.map(plan=><option key={plan.id} value={plan.id}>{plan.name}{plan.published?'':'（未发布）'}</option>)}</select></label><label>到期时间<input required type="datetime-local" value={expiresAt} onChange={event=>setExpiresAt(event.target.value)}/></label><label className="member-reason">调整原因<input required minLength={2} maxLength={200} value={reason} onChange={event=>setReason(event.target.value)} placeholder="例如：售后补偿、线下签约"/></label></div>{plansLoaded&&plans.length===0&&<p>暂无可用套餐，请先在“会员与支付”中创建套餐。</p>}<div className="member-editor-actions"><button className="account-primary" type="submit" disabled={busy||!plansLoaded||plans.length===0}>保存会员设置</button><button type="button" disabled={busy} onClick={()=>setEditingId(null)}>取消</button></div></form></td></tr>}</Fragment>)}</tbody></table></div>{data?.users.length===0&&<p>没有匹配的账号。</p>}<div className="member-pages"><button type="button" disabled={page<=1||busy} onClick={()=>{setEditingId(null);setPage(page-1);}}>上一页</button><button type="button" disabled={page>=lastPage||busy} onClick={()=>{setEditingId(null);setPage(page+1);}}>下一页</button></div></>}
  </section>;
}
