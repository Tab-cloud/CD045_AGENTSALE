import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {DomainError} from '../packages/domain/src/index';

const mocks=vi.hoisted(()=>({checkout:vi.fn(),createOrder:vi.fn(),channels:vi.fn()}));
vi.mock('../console/lib/platform',()=>({session:async()=>({id:'user-test'}),platform:async()=>({members:{createOrder:mocks.createOrder},payments:{channels:mocks.channels,checkout:mocks.checkout}})}));
vi.mock('../console/lib/local-runtime',()=>({failure:(error:unknown)=>Response.json({message:String(error)},{status:500})}));
import {POST} from '../console/app/api/v1/membership/route';

const order={id:'a'.repeat(32),channel:'alipay',status:'pending',plan:{id:'Premium',name:'聆风会员',priceCents:19900}};
let log:ReturnType<typeof vi.spyOn>;
beforeEach(()=>{mocks.channels.mockResolvedValue({alipay:true});mocks.createOrder.mockResolvedValue(order);log=vi.spyOn(console,'error').mockImplementation(()=>{});});
afterEach(()=>{vi.clearAllMocks();log.mockRestore();});
const request=()=>new Request('https://lingfeng.example/api/v1/membership',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({planId:'Premium',channel:'alipay',device:'pc'})});

it('logs a provider failure with the order ID while keeping the user response generic',async()=>{
  mocks.checkout.mockRejectedValueOnce(new DomainError('PAYMENT_PROVIDER','请管理员核对商户配置',502));
  const response=await POST(request());
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({code:'PAYMENT_CHECKOUT_UNCONFIRMED',order:{id:order.id}});
  expect(log).toHaveBeenCalledWith('Payment checkout failed:',expect.objectContaining({orderId:order.id,channel:'alipay',code:'PAYMENT_PROVIDER',reason:'请管理员核对商户配置'}));
});

it('does not log an unexpected SDK error message that could contain credentials',async()=>{
  mocks.checkout.mockRejectedValueOnce(new Error('signed URL containing secret=private-token'));
  const response=await POST(request());
  expect(response.status).toBe(502);
  expect(JSON.stringify(log.mock.calls)).not.toContain('private-token');
  expect(log).toHaveBeenCalledWith('Payment checkout failed:',expect.objectContaining({orderId:order.id,code:'UNEXPECTED',type:'Error'}));
});
