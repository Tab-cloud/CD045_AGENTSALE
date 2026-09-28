'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {platformRequest} from '../../console/components/platform-account';

type Member={id:string;username:string;phone:string|null;wechatBound:boolean;role:string;enabled:boolean;subscription:{active:boolean;membership:{plan:{name:string};expiresAt:string}|null}};
type Page={page:number;pageSize:number;total:number;users:Member[]};
export function MemberUsers(){
  const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1),[data,setData]=useState<Page|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  async function load(){const result=await platformRequest(`membership-admin?scope=users&page=${page}&q=${encodeURIComponent(search)}`) as Page;setData(result);setError('');}
  useEffect(()=>{void load().catch(reason=>setError(reason instanceof Error?reason.message:'用户列表加载失败'));},[page,search]);
  function submit(event:FormEvent){event.preventDefault();setPage(1);setSearch(query.trim());}
  async function action(kind:'revoke'|'disable'|'enable',userId:string){if(!window.confirm(kind==='revoke'?'撤销该账号的会员服务权限？':kind==='disable'?'停用该账号并撤销登录状态？':'重新启用该账号？'))return;setBusy(true);setError('');setNotice('');try{await platformRequest('membership-admin',{action:kind,userId});await load();setNotice(kind==='revoke'?'会员权限已撤销':kind==='disable'?'账号已停用':'账号已启用');}catch(reason){setError(reason instanceof Error?reason.message:'操作失败');}finally{setBusy(false);}}
  const lastPage=Math.max(1,Math.ceil((data?.total||0)/(data?.pageSize||20)));
  return <section id="users" className="billing-admin"><h2>用户与会员</h2><p>查看注册账号、手机号和微信绑定状态，管理会员权限。</p>
    <form className="member-search" onSubmit={submit}><label>搜索账号或手机号<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="输入用户名或手机号" maxLength={100}/></label><button type="submit">搜索</button></form>
    {error&&<p className="account-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!data&&!error?<p>正在加载用户…</p>:<><p>共 {data?.total||0} 个账号 · 第 {page} / {lastPage} 页</p><div className="table-wrap"><table><thead><tr><th>账号</th><th>手机号</th><th>微信</th><th>会员</th><th>到期时间</th><th>管理</th></tr></thead><tbody>{data?.users.map(user=><tr key={user.id}><td>{user.username} · {user.role==='admin'?'管理员':'用户'}{!user.enabled&&'（已停用）'}</td><td>{user.phone||'未绑定'}</td><td>{user.wechatBound?'已绑定':'未绑定'}</td><td>{user.subscription.active?user.subscription.membership?.plan.name:'未开通 / 已到期'}</td><td>{user.subscription.membership?new Date(user.subscription.membership.expiresAt).toLocaleString('zh-CN'):'—'}</td><td><button type="button" disabled={busy||!user.subscription.active} onClick={()=>void action('revoke',user.id)}>撤销会员</button><button type="button" disabled={busy} onClick={()=>void action(user.enabled?'disable':'enable',user.id)}>{user.enabled?'停用账号':'重新启用'}</button></td></tr>)}</tbody></table></div>{data?.users.length===0&&<p>没有匹配的账号。</p>}<div className="member-pages"><button type="button" disabled={page<=1||busy} onClick={()=>setPage(page-1)}>上一页</button><button type="button" disabled={page>=lastPage||busy} onClick={()=>setPage(page+1)}>下一页</button></div></>}
  </section>;
}
