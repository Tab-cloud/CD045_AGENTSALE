import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Repository } from '@agentsale/database';
import { DomainError } from '@agentsale/domain';
import type { User } from './types';
export const featureSchema=z.enum(['model','image','video','audio']);
export type Feature=z.infer<typeof featureSchema>;
export const planIdSchema=z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
export const planSchema=z.object({id:planIdSchema,name:z.string().trim().min(1).max(80),priceCents:z.number().int().min(1).max(1000000),days:z.number().int().min(1).max(366),published:z.boolean(),limits:z.object({model:z.number().int().min(-1),image:z.number().int().min(-1),video:z.number().int().min(-1),audio:z.number().int().min(-1).optional()}).strict()}).strict();
export type Plan=z.infer<typeof planSchema>;
type Membership={plan:Plan;expiresAt:string;status:'active'|'revoked'};
export type Order={id:string;userId:string;plan:Plan;channel:'wechat'|'alipay';status:'pending'|'paid'|'closed';createdAt:string;transactionId?:string;paidAt?:string;closedAt?:string};
export type DashboardSummary={
  generatedAt:string;
  totals:{users:number;activeMembers:number;paidOrders:number;pendingOrders:number;revenueCents:number};
  trend:{day:string;paidOrders:number;revenueCents:number;usage:number}[];
  usageToday:{feature:Feature;count:number}[];
  recentOrders:{id:string;username:string;planName:string;priceCents:number;channel:Order['channel'];paidAt:string}[];
};
const admin=(actor:User)=>{if(actor.role!=='admin')throw new DomainError('FORBIDDEN','仅管理员可执行此操作',403);};
const day=()=>new Date().toISOString().slice(0,10);
const includesFeature=(limit:number|undefined):limit is number=>limit===-1||typeof limit==='number'&&limit>0;
export function createMembership(repo:Repository,workspace:string){
  const read=async(userId:string)=>repo.scoped(workspace,async tx=>(await tx.execute(sql`SELECT document FROM memberships WHERE user_id=${userId}`)).rows[0]?.document as Membership|undefined);
  async function status(userId:string){const membership=await read(userId);const active=!!membership&&membership.status==='active'&&Date.parse(membership.expiresAt)>Date.now();const usage=await repo.scoped(workspace,async tx=>(await tx.execute(sql`SELECT feature,count(*)::int AS used FROM service_usage WHERE user_id=${userId} AND day=${day()} GROUP BY feature`)).rows);return {active,membership:membership||null,features:featureSchema.options.filter(f=>active&&includesFeature(membership!.plan.limits[f])),usage};}
  async function requireFeature(userId:string,feature:Feature){const value=await status(userId);if(!value.features.includes(feature))throw new DomainError('SUBSCRIPTION_REQUIRED','请订阅包含此服务的会员套餐，或续费已到期的会员',403);return value;}
  async function claimModelRequest(id:string,userId:string,inputHash:string,capability:'text.generate'|'image.generate'|'image.edit'|'video.generate'|'audio.speech'='text.generate'){return repo.scoped(workspace,async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
    await tx.execute(sql`UPDATE model_requests SET result=NULL WHERE result IS NOT NULL AND updated_at<now()-interval '7 days'`);
    const existing=(await tx.execute(sql`SELECT user_id,input_hash,capability,status,result FROM model_requests WHERE id=${id}`)).rows[0];
    if(existing){
      if(existing.user_id!==userId||existing.input_hash!==inputHash||existing.capability!==capability)throw new DomainError('MODEL_REQUEST_CONFLICT','同一模型请求编号不能用于不同内容',409);
      return {created:false,status:String(existing.status),result:existing.result as Record<string,unknown>|null};
    }
    const m=(await tx.execute(sql`SELECT document FROM memberships WHERE user_id=${userId}`)).rows[0]?.document as Membership|undefined;
    const feature:Feature=capability==='text.generate'?'model':capability==='image.generate'||capability==='image.edit'?'image':capability==='video.generate'?'video':'audio';
    const limit=m?.plan.limits[feature];
    if(!m||m.status!=='active'||Date.parse(m.expiresAt)<=Date.now()||!includesFeature(limit))throw new DomainError('SUBSCRIPTION_REQUIRED','会员未开通模型服务或已到期',403);
    if(limit!==-1){const used=Number((await tx.execute(sql`SELECT count(*) AS n FROM service_usage WHERE user_id=${userId} AND feature=${feature} AND day=${day()}`)).rows[0].n);if(used>=limit)throw new DomainError('QUOTA_EXCEEDED','今日模型额度已用完',429);}
    await tx.execute(sql`INSERT INTO model_requests (id,workspace_id,user_id,capability,input_hash,status) VALUES (${id},${workspace},${userId},${capability},${inputHash},'submitting')`);
    await tx.execute(sql`INSERT INTO service_usage VALUES(${randomUUID()},${workspace},${userId},${feature},${day()})`);
    return {created:true,status:'submitting',result:null};
  });}
  async function finishModelRequest(id:string,userId:string,result:Record<string,unknown>|null,status:'completed'|'processing'|'unknown'|'failed'=result?'completed':'unknown'){await repo.scoped(workspace,async tx=>{
    await tx.execute(sql`UPDATE model_requests SET status=${status},result=${result?JSON.stringify(result):null}::jsonb,updated_at=now() WHERE id=${id} AND user_id=${userId} AND status IN ('submitting','processing')`);
  });}
  async function modelRequest(id:string,userId:string){return repo.scoped(workspace,async tx=>{
    const row=(await tx.execute(sql`SELECT capability,status,result FROM model_requests WHERE id=${id} AND user_id=${userId}`)).rows[0];
    if(!row)throw new DomainError('NOT_FOUND','模型请求不存在',404);
    return {capability:String(row.capability),status:String(row.status),result:row.result as Record<string,unknown>|null};
  });}
  async function plans(all=false){return repo.scoped(workspace,async tx=>(await tx.execute(sql`SELECT document FROM membership_plans ORDER BY id`)).rows.map(r=>r.document as Plan).filter(p=>all||p.published));}
  async function usersPage(actor:User,page:number,query:string){
    admin(actor);
    const pageSize=20,offset=(page-1)*pageSize,needle=query.trim().toLowerCase();
    return repo.scoped(workspace,async tx=>{
      const filter=sql`(${needle}='' OR position(${needle} in lower(u.username))>0 OR position(${needle} in COALESCE(u.phone,''))>0)`;
      const total=Number((await tx.execute(sql`SELECT count(*)::int AS total FROM app_users u WHERE ${filter}`)).rows[0].total);
      const rows=(await tx.execute(sql`SELECT u.id,u.username,u.phone,u.wechat_openid IS NOT NULL AS wechat_bound,u.role,u.enabled,m.document AS membership
        FROM app_users u LEFT JOIN memberships m ON m.user_id=u.id AND m.workspace_id=u.workspace_id
        WHERE ${filter} ORDER BY u.username,u.id LIMIT ${pageSize} OFFSET ${offset}`)).rows;
      return {page,pageSize,total,users:rows.map(row=>{
        const membership=row.membership as Membership|null;
        return {id:String(row.id),username:String(row.username),phone:row.phone?String(row.phone):null,wechatBound:Boolean(row.wechat_bound),role:String(row.role),enabled:Boolean(row.enabled),
          subscription:{active:!!membership&&membership.status==='active'&&Date.parse(membership.expiresAt)>Date.now(),membership}};
      })};
    });
  }
  async function ordersPage(actor:User,page:number,query:string,status:'all'|'paid'|'pending'|'closed'){
    admin(actor);
    const pageSize=20,offset=(page-1)*pageSize,needle=query.trim().toLowerCase();
    return repo.scoped(workspace,async tx=>{
      const filter=sql`(${status}='all' OR o.status=${status}) AND (${needle}='' OR position(${needle} in lower(u.username))>0 OR position(${needle} in COALESCE(u.phone,''))>0 OR position(${needle} in lower(o.id))>0)`;
      const total=Number((await tx.execute(sql`SELECT count(*)::int AS total FROM membership_orders o JOIN app_users u ON u.id=o.user_id AND u.workspace_id=o.workspace_id WHERE ${filter}`)).rows[0].total);
      const rows=(await tx.execute(sql`SELECT o.document,u.username,u.phone FROM membership_orders o JOIN app_users u ON u.id=o.user_id AND u.workspace_id=o.workspace_id WHERE ${filter} ORDER BY o.document->>'createdAt' DESC,o.id DESC LIMIT ${pageSize} OFFSET ${offset}`)).rows;
      return {page,pageSize,total,orders:rows.map(row=>({...(row.document as Order),username:String(row.username),phone:row.phone?String(row.phone):null}))};
    });
  }
  async function savePlan(raw:unknown,actor:User){admin(actor);const result=planSchema.safeParse(raw);if(!result.success){const field=result.error.issues[0]?.path.join('.');const labels:Record<string,string>={id:'套餐标识仅支持 1–40 位英文字母、数字、下划线和短横线',name:'套餐名称需为 1–80 字',priceCents:'价格需为 0.01–10000 元',days:'有效天数需为 1–366 天','limits.model':'模型调用每日额度','limits.image':'图片生成每日额度','limits.video':'视频生成每日额度','limits.audio':'音频模型每日额度'};throw new DomainError('PLAN_INVALID',field?.startsWith('limits.')?`${labels[field]||'每日额度'}需为 -1 或非负整数`:labels[field]||'套餐字段无效，请检查填写内容',400);}const p=result.data;await repo.scoped(workspace,async tx=>{await tx.execute(sql`INSERT INTO membership_plans VALUES(${p.id},${workspace},${JSON.stringify(p)}::jsonb) ON CONFLICT(workspace_id,id) DO UPDATE SET document=excluded.document`);await audit(tx,'membership.plan',p.id,actor.id);});return p;}
  type Tx=Parameters<Parameters<Repository['scoped']>[1]>[0];
  async function audit(tx:Tx,action:string,id:string,actor:string){await tx.execute(sql`INSERT INTO audit VALUES(${randomUUID()},${workspace},${action},${id},${'操作者 '+actor},${new Date().toISOString()})`);}
  async function setMembership(userId:string,planId:string,expiresAt:string,reason:string,actor:User){
    admin(actor);
    const expiry=Date.parse(expiresAt),note=reason.trim();
    if(!Number.isFinite(expiry)||expiry<=Date.now())throw new DomainError('INVALID_EXPIRY','会员到期时间必须晚于当前时间',400);
    if(note.length<2||note.length>200)throw new DomainError('INVALID_REASON','请填写 2 至 200 字的调整原因',400);
    return repo.scoped(workspace,async tx=>{
      // Serialize manual changes with payment settlement so a paid renewal is never lost.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(450211)`);
      const account=(await tx.execute(sql`SELECT enabled FROM app_users WHERE id=${userId}`)).rows[0];
      if(!account)throw new DomainError('NOT_FOUND','用户不存在',404);
      if(!account.enabled)throw new DomainError('ACCOUNT_DISABLED','请先启用该用户账号',400);
      const row=(await tx.execute(sql`SELECT document FROM membership_plans WHERE id=${planId}`)).rows[0];
      if(!row)throw new DomainError('PLAN_UNAVAILABLE','会员套餐不存在',404);
      const plan=planSchema.parse(row.document),previous=(await tx.execute(sql`SELECT document FROM memberships WHERE user_id=${userId} FOR UPDATE`)).rows[0]?.document as Membership|undefined;
      const membership:Membership={plan,expiresAt:new Date(expiry).toISOString(),status:'active'};
      await tx.execute(sql`INSERT INTO memberships VALUES(${userId},${workspace},${JSON.stringify(membership)}::jsonb) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document WHERE memberships.workspace_id=${workspace}`);
      const detail=`操作者 ${actor.id}；原因：${note}；套餐：${previous?.plan.id||'无'} → ${plan.id}；到期：${previous?.expiresAt||'无'} → ${membership.expiresAt}`;
      await tx.execute(sql`INSERT INTO audit VALUES(${randomUUID()},${workspace},${'membership.manual_set'},${userId},${detail},${new Date().toISOString()})`);
      return membership;
    });
  }
  async function revoke(userId:string,actor:User){admin(actor);await repo.scoped(workspace,async tx=>{await tx.execute(sql`UPDATE memberships SET document=jsonb_set(document,'{status}','"revoked"'::jsonb) WHERE user_id=${userId}`);await audit(tx,'membership.revoke',userId,actor.id);});}
  async function createOrder(user:User,planId:string,channel:Order['channel']){const plan=(await plans()).find(p=>p.id===planId);if(!plan)throw new DomainError('PLAN_UNAVAILABLE','套餐已下架或不存在',404);return repo.scoped(workspace,async tx=>{await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`);const recent=Number((await tx.execute(sql`SELECT count(*) AS n FROM membership_orders WHERE user_id=${user.id} AND document->>'createdAt'>${new Date(Date.now()-3600000).toISOString()}`)).rows[0].n);if(recent>=10)throw new DomainError('ORDER_LIMIT','订单创建过于频繁，请稍后再试',429);const order:Order={id:randomUUID().replaceAll('-',''),userId:user.id,plan,channel,status:'pending',createdAt:new Date().toISOString()};await tx.execute(sql`INSERT INTO membership_orders VALUES(${order.id},${workspace},${user.id},'pending',${JSON.stringify(order)}::jsonb)`);return order;});}
  async function order(id:string,userId?:string){return repo.scoped(workspace,async tx=>{const row=(await tx.execute(sql`SELECT document FROM membership_orders WHERE id=${id}`)).rows[0];const o=row?.document as Order|undefined;if(!o||(userId&&o.userId!==userId))throw new DomainError('NOT_FOUND','订单不存在',404);return o;});}
  async function closeOrder(id:string,userId:string){return repo.scoped(workspace,async tx=>{const row=(await tx.execute(sql`SELECT document FROM membership_orders WHERE id=${id} FOR UPDATE`)).rows[0];const o=row?.document as Order|undefined;if(!o||o.userId!==userId)throw new DomainError('NOT_FOUND','订单不存在',404);if(o.status!=='pending')return o;o.status='closed';o.closedAt=new Date().toISOString();await tx.execute(sql`UPDATE membership_orders SET status='closed',document=${JSON.stringify(o)}::jsonb WHERE id=${id}`);await audit(tx,'membership.closed',id,userId);return o;});}
  async function orders(userId:string){return repo.scoped(workspace,async tx=>(await tx.execute(sql`SELECT document FROM membership_orders WHERE user_id=${userId} ORDER BY document->>'createdAt' DESC LIMIT 20`)).rows.map(r=>r.document as Order));}
  async function dashboard(actor:User):Promise<DashboardSummary>{
    admin(actor);
    const generatedAt=new Date().toISOString(),today=generatedAt.slice(0,10);
    const firstDay=new Date(Date.parse(today+'T00:00:00.000Z')-6*86400000).toISOString().slice(0,10);
    return repo.scoped(workspace,async tx=>{
      const accounts=(await tx.execute(sql`SELECT count(*)::int AS users,
        count(*) FILTER (WHERE u.enabled AND m.document->>'status'='active' AND (m.document->>'expiresAt')::timestamptz>${generatedAt}::timestamptz)::int AS active_members
        FROM app_users u LEFT JOIN memberships m ON m.user_id=u.id AND m.workspace_id=u.workspace_id WHERE u.role='operator'`)).rows[0];
      const ordersTotal=(await tx.execute(sql`SELECT count(*) FILTER (WHERE status='paid')::int AS paid_orders,
        count(*) FILTER (WHERE status='pending')::int AS pending_orders,
        COALESCE(sum((document->'plan'->>'priceCents')::int) FILTER (WHERE status='paid'),0)::bigint AS revenue_cents FROM membership_orders`)).rows[0];
      const [paidByDay,usageByDay,usageToday,recent]=await Promise.all([
        tx.execute(sql`SELECT left(document->>'paidAt',10) AS day,count(*)::int AS paid_orders,
          COALESCE(sum((document->'plan'->>'priceCents')::int),0)::bigint AS revenue_cents
          FROM membership_orders WHERE status='paid' AND document->>'paidAt'>=${firstDay}
          GROUP BY left(document->>'paidAt',10) ORDER BY day`),
        tx.execute(sql`SELECT day,count(*)::int AS usage FROM service_usage WHERE day>=${firstDay} GROUP BY day ORDER BY day`),
        tx.execute(sql`SELECT feature,count(*)::int AS count FROM service_usage WHERE day=${today} GROUP BY feature`),
        tx.execute(sql`SELECT o.id,u.username,o.document->'plan'->>'name' AS plan_name,
          (o.document->'plan'->>'priceCents')::int AS price_cents,
          o.document->>'channel' AS channel,o.document->>'paidAt' AS paid_at
          FROM membership_orders o JOIN app_users u ON u.id=o.user_id AND u.workspace_id=o.workspace_id
          WHERE o.status='paid' ORDER BY o.document->>'paidAt' DESC LIMIT 5`)
      ]);
      const paid=new Map(paidByDay.rows.map(row=>[String(row.day),row]));
      const used=new Map(usageByDay.rows.map(row=>[String(row.day),Number(row.usage)]));
      return {
        generatedAt,
        totals:{users:Number(accounts.users),activeMembers:Number(accounts.active_members),paidOrders:Number(ordersTotal.paid_orders),pendingOrders:Number(ordersTotal.pending_orders),revenueCents:Number(ordersTotal.revenue_cents)},
        trend:Array.from({length:7},(_,offset)=>{
          const day=new Date(Date.parse(firstDay+'T00:00:00.000Z')+offset*86400000).toISOString().slice(0,10),row=paid.get(day);
          return {day,paidOrders:Number(row?.paid_orders||0),revenueCents:Number(row?.revenue_cents||0),usage:used.get(day)||0};
        }),
        usageToday:featureSchema.options.map(feature=>({feature,count:Number(usageToday.rows.find(row=>row.feature===feature)?.count||0)})),
        recentOrders:recent.rows.map(row=>({id:String(row.id),username:String(row.username),planName:String(row.plan_name),priceCents:Number(row.price_cents),channel:row.channel as Order['channel'],paidAt:String(row.paid_at)}))
      };
    });
  }
  // Only called after payment-provider signature and merchant validation. Atomic and replay-safe.
  async function settle(id:string,channel:Order['channel'],cents:number,transactionId:string){return repo.scoped(workspace,async tx=>{await tx.execute(sql`SELECT pg_advisory_xact_lock(450211)`);const row=(await tx.execute(sql`SELECT document FROM membership_orders WHERE id=${id} FOR UPDATE`)).rows[0];const o=row?.document as Order|undefined;if(!o||o.channel!==channel||o.plan.priceCents!==cents||!transactionId)throw new DomainError('PAYMENT_MISMATCH','支付订单校验失败',400);if(o.status==='paid'){if(o.transactionId!==transactionId)throw new DomainError('PAYMENT_MISMATCH','支付流水不匹配',400);return o;}const m=(await tx.execute(sql`SELECT document FROM memberships WHERE user_id=${o.userId} FOR UPDATE`)).rows[0]?.document as Membership|undefined;const base=m?.status==='active'?Math.max(Date.now(),Date.parse(m.expiresAt)):Date.now();const next:Membership={plan:o.plan,status:'active',expiresAt:new Date(base+o.plan.days*86400000).toISOString()};o.status='paid';delete o.closedAt;o.transactionId=transactionId;o.paidAt=new Date().toISOString();await tx.execute(sql`INSERT INTO memberships VALUES(${o.userId},${workspace},${JSON.stringify(next)}::jsonb) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document WHERE memberships.workspace_id=${workspace}`);await tx.execute(sql`UPDATE membership_orders SET status='paid',document=${JSON.stringify(o)}::jsonb WHERE id=${id}`);await audit(tx,'membership.paid',id,channel);return o;});}
  return {status,requireFeature,claimModelRequest,finishModelRequest,modelRequest,plans,usersPage,ordersPage,savePlan,setMembership,revoke,createOrder,closeOrder,order,orders,dashboard,settle};
}
