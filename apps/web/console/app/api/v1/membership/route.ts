import {z} from 'zod';
import {session,platform} from '../../../../lib/platform';
import {failure} from '../../../../lib/local-runtime';
import {jsonBody} from '../../../../lib/server-access';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await session(request),p=await platform();return Response.json({user,subscription:await p.members.status(user.id),plans:await p.members.plans(),channels:await p.payments.channels(),orders:await p.members.orders(user.id)},{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
export async function POST(request:Request){try{
  const user=await session(request,true),p=await platform();
  const b=z.union([
    z.object({planId:z.string().max(40),channel:z.enum(['wechat','alipay']),device:z.enum(['pc','mobile']).optional()}).strict(),
    z.object({action:z.enum(['check','close']),orderId:z.string().regex(/^[a-f0-9]{32}$/)}).strict(),
  ]).parse(await jsonBody(request));
  if('action' in b){
    const order=await p.members.order(b.orderId,user.id);
    if(order.status==='paid'||b.action==='close'&&order.status==='closed')return Response.json({order},{headers:{'Cache-Control':'no-store'}});
    const result=b.action==='close'?await p.payments.close(order):await p.payments.reconcile(order);
    const updated=result?await p.members.settle(order.id,order.channel,result.cents,result.transactionId):b.action==='close'?await p.members.closeOrder(order.id,user.id):order;
    return Response.json({order:updated},{headers:{'Cache-Control':'no-store'}});
  }
  if(!(await p.payments.channels())[b.channel])return Response.json({message:'管理员尚未启用此支付方式'},{status:503});
  const order=await p.members.createOrder(user,b.planId,b.channel);
  try{
    const device=b.device||(/Android|iPhone|iPad|iPod|Mobile/i.test(request.headers.get('user-agent')||'')?'mobile':'pc');
    return Response.json({order,...await p.payments.checkout(order,device)},{headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({message:'支付请求未确认，请查看订单记录并联系管理员。订单尚未开通会员。',order},{status:502});}
}catch(e){if(e instanceof z.ZodError)return Response.json({message:'请选择套餐与支付方式'},{status:400});return failure(e);}}
