import contentFixture from './fixtures/content-kit.json';
import { afterAll,beforeAll,describe,it,expect } from 'vitest';
import { createServer,type Server } from 'node:http';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createRepository,type Repository } from '../packages/database/src';
import { defaultCosts } from '../packages/contracts/src';
import { createAuth } from '../packages/automation/src/auth';
import { createAutomation } from '../packages/automation/src/engine';
import { defaults,researchSchema,type Source,type Research,type Copy,type User,FlowError } from '../packages/automation/src/types';
import { isPublicAddress,validUrl,robotsAllows,extractSource,requestBytes } from '../packages/automation/src/network';
import { groundResearch,validateResearch,modelJson,marketing,parseBingRss,parseDuckDuckGoHtml } from '../packages/automation/src/providers';
import { createFlowStore } from '../packages/automation/src/storage';
import { safeSettings } from '../packages/automation/src/vault';
import { agentIntentSchema,inferAgentIntent,parseAgentSlash } from '../packages/automation/src/agent';
import {createCommerceConnectors,signTemu,signTikTok,verifyTikTokWebhook} from '../packages/automation/src/connectors';
import {runPublicMarketSearch,runWebResearch} from '../packages/automation/src/research-tools';
import { mediaHealth,command } from '../packages/automation/src/media';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {createHmac} from 'node:crypto';

const source:Source={id:'supplier-evidence',url:'https://example.com/supplier',title:'Fixture supplier',text:'Fixture Manufacturing is based in Shenzhen, China. We offer single-unit dropshipping. We ship directly to Germany. Product: aluminum desktop stand. This is a synthetic test source, not a real supplier.',hash:'fixture',fetchedAt:new Date().toISOString(),status:'fetched'};
const cite=(quote:string)=>({sourceId:source.id,quote});
const report:Research={summary:'基于测试来源选择供货方案',recommendation:'investigate',candidates:[{name:'Fixture Manufacturing',product:'Fixture desktop stand',sourceId:source.id,mainlandEvidence:cite('based in Shenzhen, China'),dropshipEvidence:cite('We offer single-unit dropshipping.'),markets:[{country:'Germany',shippingEvidence:cite('We ship directly to Germany.'),rationale:'来源明确列出目的国家'}],concerns:['样品与报价待核实']}],selectedIndex:0,market:'Germany',reasoning:'仅证明流程如何依据供货证据选择市场，不是实际供应商推荐',missing:['包装与实物验证'],inquiry:{subject:'代发合作询价',body:'请确认 MOQ、包装尺寸、德国运费、交期、售后与素材授权。'}};
const copy:Copy=contentFixture;
const compactedContext={objective:'在德国测试中国大陆工厂可单件代发的轻小商品',requirements:['供应商必须位于中国大陆','必须支持单件代发'],facts:[],decisions:['首个测试市场为德国'],openQuestions:['运费和交期尚未核实'],nextActions:['获取供应商报价'],memories:[{kind:'constraint',subject:'供应商区域',content:'只选择中国大陆供应商',confidence:100},{kind:'decision',subject:'首个市场',content:'首个测试市场为德国',confidence:95}]};
let repo:Repository,root:string,server:Server,baseUrl:string;
const received:any[]=[];
const actor:User={id:randomUUID(),username:'test-admin',role:'admin',enabled:true};
beforeAll(async()=>{
  repo=await createRepository();root=await mkdtemp(path.join(os.tmpdir(),'agentsale-automation-'));
  server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{const input=JSON.parse(body);received.push(input);const name=input.response_format?.json_schema?.name,prompt=String(input.messages?.at(-1)?.content||''),toolPlan=prompt.includes('"sources":[]')?(prompt.includes('"candidateUrls":[]')?{assessment:'需要先搜索供货来源',actions:[{tool:'web.search',query:'China mainland single item dropshipping Germany lightweight product',url:'',reason:'寻找候选供应商页面'}],complete:false,gaps:['缺少供货来源']}:{assessment:'需要读取候选页面',actions:[{tool:'web.fetch',query:'',url:source.url,reason:'核实大陆供货、单件代发和德国配送'}],complete:false,gaps:['需要核对网页正文']}):{assessment:'已有可供证据审查的网页正文',actions:[],complete:true,gaps:['报价与样品待线下核验']};const content=name==='connection_check'?{ready:true}:name==='supplier_research'?report:name==='research_tool_plan'?toolPlan:name==='agent_context_compaction'?compactedContext:name==='commerce_agent_intent'?{action:'chat',value:'你好，我可以和你一起梳理商品、市场和自动化任务。',explanation:'普通问候'}:copy;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:'fixture-http-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:30,completion_tokens:100}}));});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));baseUrl='http://127.0.0.1:'+(server.address() as {port:number}).port+'/v1';
});
afterAll(async()=>{await repo.close();await new Promise<void>(resolve=>server.close(()=>resolve()));if(path.basename(root).startsWith('agentsale-automation-')&&path.dirname(root)===os.tmpdir())await rm(root,{recursive:true,force:true});});
async function engine(workspace=randomUUID()){
  const automation=createAutomation(repo,workspace,path.join(root,workspace),{fetchSource:async()=>source,search:async()=>[]});
  await automation.vault.save({...defaults,baseUrl,model:'fixture-http-model',localModel:true,dailyLimitCents:100});await automation.verify();return automation;
}
async function product(workspace:string){const created=await repo.execute(workspace,{type:'product.create',name:'Fixture stand',sku:'TEST-'+randomUUID().slice(0,8),supplier:'Fixture Manufacturing',region:'中国大陆',market:'待确定',description:'Synthetic fixture input, no actual supplier.',sourceUrl:source.url,costs:defaultCosts},randomUUID());return (await repo.snapshot(workspace)).products.find(item=>item.id===created.id)!;}

describe('Agent 对话与命令',()=>{
  it('解析可审计的斜杠命令并拒绝未知命令',()=>{expect(parseAgentSlash('/goal 寻找轻小家居产品')).toMatchObject({action:'set_goal',value:'寻找轻小家居产品'});expect(parseAgentSlash('/budget 2.50')).toMatchObject({action:'set_budget',value:'2.50'});expect(()=>parseAgentSlash('/unknown')).toThrow();});
  it('模型意图协议不允许把普通对话降级为 help',()=>{expect(agentIntentSchema.safeParse({action:'help',value:'',explanation:''}).success).toBe(false);expect(parseAgentSlash('/help')).toMatchObject({action:'help'});});
  it('行动型自然语言无需模型即可映射为执行动作',()=>{expect(inferAgentIntent('现在执行一轮')).toMatchObject({action:'run'});expect(inferAgentIntent('请执行')).toMatchObject({action:'run'});expect(inferAgentIntent('请帮我找一下热销的杯子')).toMatchObject({action:'discover'});expect(inferAgentIntent('请根据销量去找')).toMatchObject({action:'discover'});expect(inferAgentIntent('展示一下当前状态')).toMatchObject({action:'status'});});
  it('请执行会按当前目标创建任务，并即时同步真实阻塞而不退回聊天追问',async()=>{const e=await engine(randomUUID()),local:User={id:'00000000-0000-4000-8000-000000000045',username:'本机用户',role:'operator',enabled:true};await e.agentChat('/goal 美国市场热销杯具',local);const result=await e.agentChat('请执行',local),conversationId=result.snapshot.conversation.id;expect(result.intent).toMatchObject({action:'run'});expect(result.snapshot.state.status).toBe('active');expect(result.snapshot.jobs).toMatchObject([{kind:'discovery',state:'queued'}]);expect(result.reply).toContain('研究子 Agent 已启动');await e.tick();await e.tick();await e.agentTick();const blocked=await e.agentSnapshot(conversationId);expect(blocked.state.status).toBe('blocked');expect(blocked.state.lastError).toContain('SOURCE_UNAVAILABLE');expect((await e.store.get(blocked.jobs[0].id)).steps[0].summary).toContain('尚未取得可采集来源');});
  it('本机执行身份可启动 Agent，并在后续周期继续运行',async()=>{const e=await engine(randomUUID()),local:User={id:'00000000-0000-4000-8000-000000000045',username:'本机用户',role:'operator',enabled:true};const started=await e.agentChat('/start',local);expect(started.snapshot.state.owner).toMatchObject({id:local.id});const resumed=await e.runAgentCycle(started.snapshot.conversation.id,undefined,true);expect(resumed.state.lastError).not.toContain('OWNER_UNAVAILABLE');});
  it('公开检索遇到短暂网络故障时自动重试一次',async()=>{const e=await engine(randomUUID()),local:User={id:'00000000-0000-4000-8000-000000000045',username:'本机用户',role:'operator',enabled:true};const started=await e.agentChat('/start',local),job=(await e.store.list())[0],claimed=await e.store.claim();expect(claimed?.job.id).toBe(job.id);await e.store.finish(job.id,claimed!.lease,claimed!.step,{},'DNS_TIMEOUT：域名解析超时');const result=await e.runAgentCycle(started.snapshot.conversation.id,local,true),retried=await e.store.get(job.id);expect(result.state.lastAction).toContain('自动重试');expect(retried.state).toBe('queued');expect(retried.error).toBe('');});
  it('新建对话隔离消息、目标、模型上下文和任务视图',async()=>{const e=await engine(randomUUID()),local:User={id:'00000000-0000-4000-8000-000000000045',username:'本机用户',role:'operator',enabled:true};const first=await e.agentChat('/goal 德国市场轻小商品',local),firstId=first.snapshot.conversation.id;await e.agentChat('第一段对话唯一标记 ALPHA',local,firstId);const second=await e.createConversation();expect(second.conversation.id).not.toBe(firstId);expect(second.messages).toHaveLength(0);expect(second.jobs).toHaveLength(0);await e.agentChat('/goal 美国市场家居商品',local,second.conversation.id);const start=received.length;await e.agentChat('第二段对话唯一标记 BETA',local,second.conversation.id);const secondPrompt=received.slice(start).find(input=>input.response_format?.json_schema?.name==='commerce_agent_intent').messages.at(-1).content;expect(secondPrompt).toContain('BETA');expect(secondPrompt).not.toContain('ALPHA');const restored=await e.agentSnapshot(firstId);expect(restored.state.objective).toBe('德国市场轻小商品');expect(restored.messages.map(message=>message.content).join('\n')).not.toContain('美国市场家居商品');const resume=received.length;await e.agentChat('继续刚才的话题',local,firstId);const firstPrompt=received.slice(resume).find(input=>input.response_format?.json_schema?.name==='commerce_agent_intent').messages.at(-1).content;expect(firstPrompt).toContain('ALPHA');expect(firstPrompt).not.toContain('BETA');});
  it('普通自然语言由模型生成对话回复，不退化为命令列表',async()=>{const e=await engine(randomUUID()),local:User={id:'00000000-0000-4000-8000-000000000045',username:'本机用户',role:'operator',enabled:true};const result=await e.agentChat('你好，先介绍一下你能怎样帮我',local);expect(result.reply).toContain('商品、市场和自动化任务');expect(result.reply).not.toContain('/status');});
  it('每次模型对话使用可审计上下文，并在超阈值后形成版本化摘要和长期记忆',async()=>{
    const e=await engine(randomUUID()),local:User={id:'00000000-0000-4000-8000-000000000045',username:'本机用户',role:'operator',enabled:true},start=received.length;
    for(let index=0;index<13;index++)await e.agentChat(index===0?'请记住：首个市场选择德国，合作方必须位于中国大陆并支持单件代发。':`继续讨论第 ${index+1} 个经营问题。`,local);
    const calls=received.slice(start).filter(input=>input.response_format?.json_schema?.name==='commerce_agent_intent');
    expect(calls).toHaveLength(13);expect(calls[1].messages.at(-1).content).toContain('首个市场选择德国');
    const snapshot=await e.context.snapshot();
    expect(snapshot.summary).toMatchObject({version:1,document:{objective:compactedContext.objective}});expect(snapshot.memories).toEqual(expect.arrayContaining([expect.objectContaining({kind:'constraint',subject:'供应商区域'})]));
    expect(snapshot.runs).toHaveLength(13);expect(snapshot.runs.every((run:any)=>run.status==='completed'&&Number(run.estimated_tokens)<=12000)).toBe(true);
  });
  it('升级前的大量历史消息不会遮住本次最新输入',async()=>{
    const workspace=randomUUID(),e=await engine(workspace),local:User={id:'00000000-0000-4000-8000-000000000045',username:'本机用户',role:'operator',enabled:true};
    await repo.scoped(workspace,async tx=>{for(let index=0;index<130;index++)await tx.execute(sql`INSERT INTO commerce_agent_messages(id,workspace_id,role,kind,content,payload,created_at) VALUES(${randomUUID()},${workspace},'user','message',${`旧消息 ${index+1}`},'{}'::jsonb,${new Date(Date.now()+index).toISOString()})`);});
    const start=received.length;await e.agentChat('这是最新一轮提问，回答时不要遗漏。',local);
    const call=received.slice(start).find(input=>input.response_format?.json_schema?.name==='commerce_agent_intent');
    expect(call.messages.at(-1).content).toContain('这是最新一轮提问');
  });
});
describe('公开网页搜索降级',()=>{
  it('没有搜索密钥时可解析内置 RSS 搜索结果并去重',()=>{const xml='<?xml version="1.0"?><rss><channel><item><title>Cup supplier</title><link>https://supplier.example/cups</link><description><![CDATA[China cup <b>supplier</b>]]></description></item><item><title>Duplicate</title><link>https://supplier.example/cups</link><description>same</description></item></channel></rss>';expect(parseBingRss(xml)).toEqual([{url:'https://supplier.example/cups',title:'Cup supplier',description:'China cup supplier',source:'bing_rss'}]);});
  it('优先解析 DuckDuckGo HTML 并还原结果跳转地址',()=>{const html='<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsupplier.example%2Fcups">Cup supplier</a><div class="result__snippet">China cup supplier</div></div>';expect(parseDuckDuckGoHtml(html)).toEqual([{url:'https://supplier.example/cups',title:'Cup supplier',description:'China cup supplier',source:'duckduckgo_html'}]);});
  it('无需平台账号即可自动检索并保存公开市场来源',async()=>{
    const queries:string[]=[],events:string[]=[];
    const result=await runPublicMarketSearch({objective:'美国市场轻小杯具',search:async query=>{queries.push(query);return [{url:source.url,title:'Public market fixture',description:'price and delivery observations',source:'bing_rss'}];},fetch:async()=>source,onProgress:async event=>{events.push(event.title);}});
    expect(queries).toHaveLength(2);expect(queries.join(' ')).toContain('price');expect(queries.join(' ')).toContain('United States');expect(result.sources).toMatchObject([{id:source.id,category:'market'}]);expect(result.toolRuns.some(run=>run.tool==='web.search'&&run.status==='succeeded')).toBe(true);expect(events).toEqual(expect.arrayContaining(['正在检索公开市场信息','公开市场来源已保存','公开市场检索已整理']));
  });
});
describe('渠道连接器协议',()=>{
  it('按官方规则签名 TikTok、Temu 并验证 TikTok Webhook',()=>{
    const secret='fixture-secret',path='/order/202309/orders/search',body='{"page_size":100}',query={timestamp:1696909648,shop_cipher:'ROW_fixture',app_key:'fixture-key',access_token:'excluded'};
    const message=secret+path+'app_keyfixture-keyshop_cipherROW_fixturetimestamp1696909648'+body+secret;
    expect(signTikTok(path,query,body,secret)).toBe(createHmac('sha256',secret).update(message).digest('hex'));
    expect(signTemu({type:'bg.order.list.v2.get',pageSize:10,app_key:'key'},secret)).toMatch(/^[A-F0-9]{32}$/);
    const raw=Buffer.from('{"tts_notification_id":"123"}'),signature=createHmac('sha256',secret).update('fixture-key').update(raw).digest('hex');expect(verifyTikTokWebhook(raw,signature,'fixture-key',secret)).toBe(true);expect(verifyTikTokWebhook(raw,signature+'0','fixture-key',secret)).toBe(false);
  });
  it('真实协议响应可验证连接、同步订单并幂等保存事件',async()=>{
    const w=randomUUID(),e=await engine(w),p=await product(w),current=await e.vault.get(),{apiKey:_a,searchKey:_s,minimaxKey:_m,connectorSecrets:_c,verifiedAt:_v,revision:_r,...publicSettings}=current;await e.vault.save({...publicSettings,connectors:{...publicSettings.connectors,tiktokShop:{enabled:true,baseUrl:'https://open-api.tiktokglobalshop.com',appKey:'fixture-key',shopCipher:'ROW_fixture'}}},undefined,undefined,undefined,{tiktokShopAppSecret:'fixture-secret',tiktokShopAccessToken:'fixture-token'});
    const mock=async(raw:string,options:any)=>{const url=new URL(raw);if(url.pathname==='/authorization/202309/shops')return {status:200,headers:{},body:Buffer.from('{"code":0,"data":{"shops":[]}}'),url:raw};if(url.pathname==='/product/202502/products/search')return {status:200,headers:{},body:Buffer.from(JSON.stringify({code:0,data:{products:[{id:'REMOTE-1',skus:[{seller_sku:p.sku}]}]}})),url:raw};if(url.pathname==='/analytics/202605/shop_products/performance')return {status:200,headers:{},body:Buffer.from('{"code":0,"data":{"products":[{"id":"REMOTE-1","total_performance":{"items_sold":12,"product_impressions":3400,"ctr":0.041}}]}}'),url:raw};if(url.pathname==='/finance/202309/statements')return {status:200,headers:{},body:Buffer.from('{"code":0,"data":{"statements":[{"id":"STATEMENT-1","statement_time":1696909648,"settlement_amount":"10.00","currency":"USD"}]}}'),url:raw};if(url.pathname==='/return_refund/202309/returns/search')return {status:200,headers:{},body:Buffer.from('{"code":0,"data":{"return_orders":[{"return_id":"RETURN-1","create_time":1696909648,"return_status":"RETURN_OR_REFUND_REQUEST_PENDING"}]}}'),url:raw};if(url.pathname==='/product/202309/products'){expect(JSON.parse(String(options.body))).toMatchObject({title:'Fixture listing',idempotency_key:'catalog-1'});return {status:200,headers:{},body:Buffer.from('{"code":0,"data":{"product_id":"REMOTE-2"}}'),url:raw};}expect(options.method).toBe('POST');return {status:200,headers:{},body:Buffer.from('{"code":0,"data":{"orders":[{"id":"ORDER-1","status":"AWAITING_SHIPMENT","update_time":1696909648,"payment":{"currency":"USD","total_amount":"19.99"}}]}}'),url:raw};};
    const connectors=createCommerceConnectors(repo,w,e.vault,mock as any);
    expect(JSON.stringify(safeSettings(await e.vault.get()))).not.toContain('fixture-secret');expect(await readFile(path.join(e.root,'private/providers.sealed'),'utf8')).not.toContain('fixture-token');
    expect((await connectors.verify('tiktok_shop')).verified).toBe(true);
    expect(await connectors.syncOrders()).toMatchObject([{connector:'tiktok_shop',count:1}]);
    expect(await connectors.orders()).toMatchObject([{externalId:'ORDER-1',totalMinor:1999}]);
    const market=await connectors.syncMarket();if(market[0]?.error)throw new Error(market[0].error);
    expect(market).toMatchObject([{connector:'tiktok_shop',count:1}]);
    expect((await repo.snapshot(w)).marketSignals[0]).toMatchObject({productId:p.id,platform:'tiktok_shop',unitsSold7d:12,views7d:3400,engagementRateBps:410});
    expect(await connectors.syncOperations()).toMatchObject([{connector:'tiktok_shop',kind:'finance',count:1},{connector:'tiktok_shop',kind:'aftersales',count:1}]);expect(await connectors.records('finance_statement')).toMatchObject([{externalId:'STATEMENT-1'}]);
    expect(await connectors.createChannelProduct('tiktok_shop',{title:'Fixture listing'},'catalog-1')).toMatchObject({data:{product_id:'REMOTE-2'}});
    expect(await connectors.receiveEvent('tiktok_shop','event-1','ORDER_STATUS_CHANGE',{})).toMatchObject({accepted:true});
    expect(await connectors.receiveEvent('tiktok_shop','event-1','ORDER_STATUS_CHANGE',{})).toMatchObject({duplicate:true});
    expect(await connectors.receiveEvent('customer_bridge','case-1','refund.opened',{order:'ORDER-1'})).toMatchObject({accepted:true});
    expect(await connectors.claimReceived('customer_bridge','case-1')).toMatchObject({claimed:true});
    expect(await connectors.claimReceived('customer_bridge','case-1')).toMatchObject({claimed:false});
  });
  it('Bridge 使用鉴权和幂等键执行客服动作',async()=>{
    const w=randomUUID(),e=await engine(w),current=await e.vault.get(),{apiKey:_a,searchKey:_s,minimaxKey:_m,connectorSecrets:_c,verifiedAt:_v,revision:_r,...publicSettings}=current;
    await e.vault.save({...publicSettings,connectors:{...publicSettings.connectors,customerBridge:{enabled:true,autoExecute:true,baseUrl:'https://customer.example.com'}}},undefined,undefined,undefined,{customerBridgeToken:'bridge-secret'});
    const calls:any[]=[];const mock=async(raw:string,options:any)=>{calls.push({raw,options});return {status:200,headers:{},body:Buffer.from('{"accepted":true}'),url:raw};},connectors=createCommerceConnectors(repo,w,e.vault,mock as any);
    expect((await connectors.verify('customer_bridge')).verified).toBe(true);expect(await connectors.customerAction({caseId:'CASE-1'},'customer:CASE-1')).toMatchObject({accepted:true});expect(calls[1].raw).toBe('https://customer.example.com/v1/cases/actions');expect(calls[1].options.headers).toMatchObject({Authorization:'Bearer bridge-secret','Idempotency-Key':'customer:CASE-1','X-AgentSale-Protocol':'2026-09-06'});
  });
  it('TikTok Shop OAuth 使用一次性 state，保存店铺并刷新 Token',async()=>{
    const w=randomUUID(),e=await engine(w),current=await e.vault.get(),{apiKey:_a,searchKey:_s,minimaxKey:_m,connectorSecrets:_c,verifiedAt:_v,revision:_r,...publicSettings}=current;await e.vault.save({...publicSettings,connectors:{...publicSettings.connectors,tiktokShop:{enabled:true,baseUrl:'https://open-api.tiktokglobalshop.com',appKey:'oauth-key',serviceId:'service-1',authRegion:'us',shopCipher:''}}},undefined,undefined,undefined,{tiktokShopAppSecret:'oauth-secret'});
    let refresh=false;const mock=async(raw:string)=>{const url=new URL(raw);if(url.pathname==='/api/v2/token/get')return {status:200,headers:{},body:Buffer.from('{"code":0,"data":{"access_token":"access-1","refresh_token":"refresh-1","access_token_expire_in":1900000000,"refresh_token_expire_in":2000000000,"user_type":0,"seller_name":"Fixture Seller","granted_scopes":["seller.order.info"]}}'),url:raw};if(url.pathname==='/api/v2/token/refresh'){refresh=true;return {status:200,headers:{},body:Buffer.from('{"code":0,"data":{"access_token":"access-2","refresh_token":"refresh-2","access_token_expire_in":1900001000,"refresh_token_expire_in":2000001000}}'),url:raw};}return {status:200,headers:{},body:Buffer.from('{"code":0,"data":{"shops":[{"cipher":"SHOP-CIPHER","name":"Fixture Shop"}]}}'),url:raw};},connectors=createCommerceConnectors(repo,w,e.vault,mock as any),authorization=await connectors.beginAuthorization('tiktok_shop'),authUrl=new URL(authorization.url),state=authUrl.searchParams.get('state')!;expect(authUrl.hostname).toBe('services.us.tiktokshop.com');expect(authUrl.searchParams.get('service_id')).toBe('service-1');expect(await connectors.completeAuthorization('tiktok_shop',state,'one-time-code')).toMatchObject({authorized:true,shops:1});await expect(connectors.completeAuthorization('tiktok_shop',state,'one-time-code')).rejects.toMatchObject({code:'OAUTH_STATE_INVALID'});expect(await e.vault.get()).toMatchObject({connectors:{tiktokShop:{shopCipher:'SHOP-CIPHER'}},connectorSecrets:{tiktokShopAccessToken:'access-1',tiktokShopRefreshToken:'refresh-1'}});expect(await connectors.refreshTikTokToken(true)).toBe(true);expect(refresh).toBe(true);expect((await e.vault.get()).connectorSecrets.tiktokShopAccessToken).toBe('access-2');
  });
  it('Temu US 回调授权交换 Token 并保存实际权限',async()=>{
    const w=randomUUID(),e=await engine(w),current=await e.vault.get(),{apiKey:_a,searchKey:_s,minimaxKey:_m,connectorSecrets:_c,verifiedAt:_v,revision:_r,...publicSettings}=current;await e.vault.save({...publicSettings,connectors:{...publicSettings.connectors,temu:{enabled:true,baseUrl:'https://openapi-b-us.temu.com/openapi/router',appKey:'temu-key'}}},undefined,undefined,undefined,{temuAppSecret:'temu-secret'});const mock=async(raw:string,options:any)=>({status:200,headers:{},body:Buffer.from('{"success":true,"result":{"accessToken":"temu-access","mallId":42,"apiScopeList":["bg.order.list.v2.get"],"appSubscribeEventCodeList":["bg_order_status_change_event"],"expiredTime":1900000000}}'),url:raw}),connectors=createCommerceConnectors(repo,w,e.vault,mock as any),authorization=await connectors.beginAuthorization('temu'),url=new URL(authorization.url),state=url.searchParams.get('state')!;expect(url.hostname).toBe('seller.temu.com');expect(url.searchParams.get('redirect_uri')).toContain('/api/v1/oauth/temu/callback');expect(await connectors.completeAuthorization('temu',state,'temu-code')).toMatchObject({authorized:true,mallId:42});expect((await e.vault.get()).connectorSecrets.temuAccessToken).toBe('temu-access');expect(await connectors.records('authorization')).toMatchObject([{connector:'temu',document:{apiScopeList:['bg.order.list.v2.get']}}]);
  });
});

describe('管理员与运营权责',()=>{
  it('首次建立管理员，登录产生真实会话；运营不能进入管理员权限',async()=>{
    const auth=createAuth(repo,randomUUID());expect(await auth.setupNeeded()).toBe(true);
    await auth.create('admin-test','Strong-test-password','operator');expect(await auth.setupNeeded()).toBe(false);
    const session=await auth.login('admin-test','Strong-test-password');expect(session.user.role).toBe('admin');expect(await auth.require(session.token,true)).toMatchObject({role:'admin'});await expect(auth.require(session.token,'operator')).rejects.toMatchObject({status:403});
    const op=await auth.create('operator-test','Strong-test-password','operator',session.user),login=await auth.login(op.username,'Strong-test-password');expect(await auth.require(login.token,'operator')).toMatchObject({role:'operator'});
    await expect(auth.require(login.token,true)).rejects.toMatchObject({status:403});await expect(auth.create('second-test','Strong-test-password','admin',op)).rejects.toMatchObject({status:403});
    await auth.disable(op.id,session.user);await expect(auth.require(login.token)).rejects.toMatchObject({status:401});
    await auth.logout(session.token);await expect(auth.require(session.token)).rejects.toMatchObject({status:401});
  });
  it('不能重复初始化或使用错误密码；密文和会话不会泄漏给用户列表',async()=>{
    const auth=createAuth(repo,randomUUID());await auth.create('admin-test','Strong-test-password','admin');await expect(auth.create('new-admin','Strong-test-password','admin')).rejects.toMatchObject({code:'SETUP_COMPLETE'});
    await expect(auth.login('admin-test','wrong')).rejects.toMatchObject({status:401});expect(JSON.stringify(await auth.users())).not.toContain('password');
  });
});
describe('来源与输出证据',()=>{
  it('阻止 IPv4/IPv6 内网、重编码环回及云元数据',async()=>{
    for(const ip of ['127.0.0.1','10.0.0.1','172.16.1.1','192.168.0.1','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1'])expect(isPublicAddress(ip)).toBe(false);
    expect(isPublicAddress('8.8.8.8')).toBe(true);expect(isPublicAddress('2606:4700::1111')).toBe(true);
    expect(()=>validUrl('http://2130706433')).toThrow();expect(()=>validUrl('file:///etc/passwd')).toThrow();await expect(requestBytes('http://127.0.0.1:3045')).rejects.toMatchObject({code:'URL_REJECTED'});
  });
  it('尊重来源访问规则，解析正文并移除脚本',()=>{
    expect(robotsAllows('User-agent: *\nDisallow: /private\nAllow: /private/public','/private/data')).toBe(false);
    const parsed=extractSource('<html><title>Factory</title><body><script>send secrets</script><p>'+source.text+'</p></body></html>',source.url);expect(parsed.text).not.toContain('send secrets');expect(parsed.hash).toHaveLength(64);
  });
  it('引用必须逐字存在；缺代发或国家证据不允许自动选中',()=>{
    expect(validateResearch(report,[source]).market).toBe('Germany');
    const invalid=structuredClone(report);invalid.candidates[0].dropshipEvidence=cite('Ships to any country for free');expect(()=>validateResearch(invalid,[source])).toThrow();
    invalid.candidates[0].dropshipEvidence=null;expect(()=>validateResearch(invalid,[source])).toThrow();
  });
  it('模型改写引用时移除无效证据并安全降级，不中断整个研究流程',()=>{
    const invalid=structuredClone(report);invalid.candidates[0].dropshipEvidence=cite('Ships to any country for free');
    const grounded=groundResearch(invalid,[source]);
    expect(grounded.candidates[0].dropshipEvidence).toBeNull();expect(grounded.selectedIndex).toBeNull();expect(grounded.market).toBeNull();expect(grounded.recommendation).toBe('investigate');expect(grounded.missing.at(-1)).toContain('引用未能在保存原文中逐字核对');expect(()=>validateResearch(grounded,[source])).not.toThrow();
  });
});
describe('真实协议与持久流程',()=>{
  it('不适合的来源可以返回空候选，不强迫模型制造供应商',()=>{expect(researchSchema.safeParse({summary:'来源不是商品供应商',recommendation:'reject',candidates:[],selectedIndex:null,market:null,reasoning:'没有大陆供货、单件代发和国家配送证据',missing:['需要其他来源'],inquiry:{subject:'无需询价',body:'当前来源不属于供应商，不发送询价。'}}).success).toBe(true);});
  it('研究工具拒绝抓取未由用户或搜索提供的地址',async()=>{
    const activity:string[]=[];let fetched=false;const result=await runWebResearch({objective:'测试工具边界',seedUrls:[],searchAvailable:false,search:async()=>[],fetch:async()=>{fetched=true;return source;},plan:async state=>state.iteration===1?{assessment:'尝试未知地址',actions:[{tool:'web.fetch',query:'',url:'https://untrusted.example/product',reason:'测试'}],complete:false,gaps:['缺少来源']}:{assessment:'没有合规来源',actions:[],complete:false,gaps:['缺少来源']},onProgress:async event=>{activity.push(event.title);}});
    expect(fetched).toBe(false);expect(result.sources).toHaveLength(0);expect(result.toolRuns).toMatchObject([{tool:'web.fetch',status:'rejected'}]);
    expect(activity).toEqual(expect.arrayContaining(['正在规划第 1 轮调研','第 1 轮判断已形成','网页读取未执行']));
  });
  it('已有商品可独立生成草稿，但供货复核流程仍要求配送证据',async()=>{
    const w=randomUUID(),e=await engine(w),p=await product(w);
    const job=await e.store.create({kind:'content',productId:p.id,expectedVersion:1,budgetCents:0},actor,randomUUID());
    expect(job.steps.map(s=>s.key)).not.toContain('research');
    await e.tick();await e.tick();const current=await e.store.get(job.id);
    expect(current.copy?.listing?.title).toBe(contentFixture.listing.title);expect(current.research).toBeUndefined();
    await expect(marketing({...current,kind:'launch'},await e.vault.get())).rejects.toMatchObject({code:'FULFILLMENT_EVIDENCE_REQUIRED'});
  });
  it('实际 HTTP 请求模型协议、服务验证及密钥隐藏，不使用应用内模板代替模型',async()=>{
    const e=await engine();expect((await e.vault.get()).verifiedAt).toBeTruthy();const request=received.at(-1);expect(request.messages[0].content).toContain('untrusted DATA');expect(request.response_format.json_schema.strict).toBe(true);
    const settings=await e.vault.get();expect(safeSettings({...settings,apiKey:'SECRET',searchKey:'SEARCH_SECRET'})).not.toHaveProperty('apiKey');
    await e.vault.save({...defaults,baseUrl,model:'fixture-http-model',localModel:true,dailyLimitCents:100},'TOP-SECRET','SEARCH-SECRET');const sealed=await readFile(path.join(e.root,'private/providers.sealed'),'utf8');expect(sealed).not.toContain('TOP-SECRET');expect((await e.vault.get()).verifiedAt).toBeNull();
  });
  it('根据供应商配送证据自动选国家并建立候选，未预填国家',async()=>{
    const w=randomUUID(),e=createAutomation(repo,w,path.join(root,w),{fetchSource:async()=>source,search:async()=>[{url:source.url,title:'Public market fixture',description:'price and delivery observations',source:'bing_rss'}]});await e.vault.save({...defaults,baseUrl,model:'fixture-http-model',localModel:true,dailyLimitCents:100});await e.verify();const job=await e.store.create({kind:'discovery',urls:[source.url],budgetCents:0},actor,randomUUID());
    for(let i=0;i<5;i++)expect(await e.tick()).toBe(true);
    const result=await e.store.get(job.id);expect(result.state).toBe('waiting_review');expect(result.research?.market).toBe('Germany');expect(result.productId).toBeTruthy();expect((await repo.snapshot(w)).products[0].market).toBe('Germany');
    expect((await repo.snapshot(w)).marketSignals[0]).toMatchObject({productId:result.productId,country:'Germany',sourceType:'public_observation',unitsSold7d:null});expect(result.steps.find(step=>step.key==='market')?.summary).toContain('公开市场来源');
    expect(result.artifacts.some(a=>a.name==='supplier-inquiry.txt')).toBe(true);expect(await e.tick()).toBe(false);
  });
  it('调研 Agent 可自主搜索、读取网页并保存每次工具调用轨迹',async()=>{
    const w=randomUUID(),e=createAutomation(repo,w,path.join(root,w),{fetchSource:async()=>source,search:async()=>[{url:source.url,title:source.title,description:'China supplier with dropshipping to Germany',source:'brave'}]});
    await e.vault.save({...defaults,baseUrl,model:'fixture-http-model',localModel:true,dailyLimitCents:100},undefined,'FIXTURE-SEARCH-KEY');await e.verify();
    const job=await e.store.create({kind:'discovery',urls:[],budgetCents:10},actor,randomUUID());expect(await e.tick()).toBe(true);
    const result=await e.store.get(job.id);expect(result.sources).toMatchObject([{id:source.id,status:'fetched'}]);expect(result.toolRuns?.map(run=>[run.tool,run.status])).toEqual([['web.search','succeeded'],['web.fetch','succeeded']]);expect(result.researchPlans?.at(-1)).toMatchObject({complete:true});expect(result.researchGaps).toContain('报价与样品待线下核验');
    expect(result.activity?.map(item=>item.title)).toEqual(expect.arrayContaining(['开始执行：寻找供货来源','正在规划第 1 轮调研','正在搜索公开网页','网页搜索完成','网页读取完成','寻找供货来源已完成']));
  });
  it('配置串行保存，旧连接验证不能覆盖新配置；切换端点清除原模型密钥',async()=>{
    const e=await engine(),settings={...defaults,baseUrl,model:'fixture-http-model',localModel:true,dailyLimitCents:100};await e.vault.save(settings,'OLD-ENDPOINT-KEY','SEARCH-KEY');const before=await e.vault.get();
    const results=await Promise.allSettled([e.vault.save({...settings,model:'new-model'}),e.vault.verified(before.revision)]);
    expect(results[0].status).toBe('fulfilled');expect(results[1]).toMatchObject({status:'rejected',reason:{code:'CONFIG_CHANGED'}});
    expect(await e.vault.get()).toMatchObject({model:'new-model',apiKey:'OLD-ENDPOINT-KEY',verifiedAt:null});
    await e.vault.save({...settings,baseUrl:'http://127.0.0.1:11434/v1'});expect(await e.vault.get()).toMatchObject({apiKey:'',searchKey:'SEARCH-KEY'});
    await e.vault.save(settings,undefined,'');expect(safeSettings(await e.vault.get()).hasSearchKey).toBe(false);
    const mistakenMiniMax={...defaults,baseUrl:'https://api.openai.com/v1',model:'minimax-m3',protocol:'openai' as const,callLimitCents:25,dailyLimitCents:200};
    await e.vault.save(mistakenMiniMax,'MINIMAX-ENDPOINT-KEY');
    await e.vault.save({...mistakenMiniMax,baseUrl:'https://api.minimaxi.com/v1',model:'MiniMax-M3',protocol:'minimax',format:'prompt_json'},undefined,undefined,undefined,undefined,true);
    expect(await e.vault.get()).toMatchObject({apiKey:'MINIMAX-ENDPOINT-KEY',baseUrl:'https://api.minimaxi.com/v1',protocol:'minimax'});
  });
  it('错误标识可跨服务路由模块读取，未知错误不伪装业务状态',()=>{
    const error=new FlowError('MODEL_UNCONFIGURED','请配置服务');expect(FlowError.is(error)).toBe(true);
    const crossModule=Object.assign(new Error('请配置服务'),{[Symbol.for('agentsale.flow-error')]:true,code:'MODEL_UNCONFIGURED',status:422});expect(FlowError.is(crossModule)).toBe(true);expect(FlowError.is(new Error('unknown'))).toBe(false);
  });
  it('无模型时保留来源与计算并阻塞 AI，不制造草稿',async()=>{
    const w=randomUUID(),e=createAutomation(repo,w,path.join(root,w),{fetchSource:async()=>source}),p=await product(w);const j=await e.store.create({kind:'launch',productId:p.id,expectedVersion:1,budgetCents:0},actor,randomUUID());
    await e.tick();await e.tick();await e.tick();const result=await e.store.get(j.id);expect(result.state).toBe('blocked');expect(result.steps[0].state).toBe('done');expect(result.error).toContain('MODEL_UNCONFIGURED');expect(result.copy).toBeUndefined();
  });
  it('版本、幂等、暂停、取消和中断恢复不会重跑成功步骤',async()=>{
    const w=randomUUID(),e=await engine(w),p=await product(w),input={kind:'launch',productId:p.id,expectedVersion:1,budgetCents:0},key=randomUUID();const job=await e.store.create(input,actor,key);expect((await e.store.create(input,actor,key)).id).toBe(job.id);await expect(e.store.create({...input,budgetCents:1},actor,key)).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    await e.tick();let j=await e.store.get(job.id);await e.store.control(j.id,'pause',j.version,actor);expect(await e.tick()).toBe(false);j=await e.store.get(j.id);await e.store.control(j.id,'resume',j.version,actor);
    const claimed=await e.store.claim();expect(claimed?.step).toBe('cost');expect(await e.store.claim()).toBeNull();await e.store.recover();j=await e.store.get(j.id);expect(j.state).toBe('blocked');expect(j.steps[0].state).toBe('done');
    await e.store.control(j.id,'resume',j.version,actor);await repo.execute(w,{type:'product.costs',id:p.id,expectedVersion:1,costs:{...defaultCosts,revenueMinor:3990}},randomUUID());await e.tick();j=await e.store.get(j.id);expect(j.error).toContain('VERSION_CONFLICT');
    await e.store.control(j.id,'cancel',j.version,actor);expect(await e.tick()).toBe(false);
  });
  it('数据库原子预留拒绝并发超额，并保留结果未知的费用',async()=>{
    const e=await engine(),s={...await e.vault.get(),dailyLimitCents:10};const results=await Promise.allSettled([e.store.reserve('j',7,'model',s,20),e.store.reserve('j',7,'model',s,20)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const id=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<string>).value;await e.store.settle(id,'unknown',null);await expect(e.store.reserve('j',4,'model',s,20)).rejects.toMatchObject({code:'BUDGET_EXCEEDED'});
    const unlimited={...s,dailyLimitCents:0};await expect(e.store.reserve('unlimited',7,'model',unlimited,20)).resolves.toBeTypeOf('string');await expect(e.store.reserve('unlimited',7,'model',unlimited,20)).resolves.toBeTypeOf('string');
  });
  it('不同工作区看不到流程、账号、素材或调用账本',async()=>{
    const e=await engine(),w=randomUUID(),other=createFlowStore(repo,w);expect(await other.list()).toHaveLength(0);expect(await other.assets()).toHaveLength(0);expect(await other.spend()).toHaveLength(0);
    const rows=await repo.scoped(w,tx=>tx.execute(sql`SELECT * FROM app_users`));expect(rows.rows).toHaveLength(0);
  });
  it('完整处理图片、真实 MP4 编码/解码、字幕和文件清单',async()=>{
    expect(await mediaHealth()).toBe(true);const w=randomUUID(),e=await engine(w),p=await product(w);const job=await e.store.create({kind:'launch',productId:p.id,expectedVersion:1,budgetCents:0},actor,randomUUID());
    for(let i=0;i<5;i++)await e.tick();let result=await e.store.get(job.id);expect(result.error).toContain('ASSET_REQUIRED');expect(result.copy?.scenes).toHaveLength(3);
    const image=await sharp({create:{width:600,height:700,channels:3,background:'#d2d7db'}}).png().toBuffer();await e.upload(p.id,'fixture.png','Synthetic test asset, owned by the test',image);await e.store.control(result.id,'resume',result.version,actor);await e.tick();await e.tick();await e.tick();result=await e.store.get(job.id);
    expect(result.state).toBe('waiting_review');expect(result.artifacts.filter(a=>a.name.startsWith('poster-'))).toHaveLength(3);expect(result.artifacts.some(a=>a.name==='product-description.html')).toBe(true);const video=result.artifacts.find(a=>a.mime==='video/mp4')!;expect(video.bytes).toBeGreaterThan(10000);const probe=JSON.parse(await command('ffprobe',['-v','error','-show_streams','-of','json',path.join(e.root,video.file)]));expect(probe.streams[0]).toMatchObject({codec_name:'h264',width:720,height:1280});expect(result.artifacts.some(a=>a.name==='manifest.json')).toBe(true);
    await e.store.control(result.id,'approve',result.version,actor);result=await e.store.get(result.id);expect(result.state).toBe('succeeded');
    const revised={...result.copy!,title:'Revised fixture',scenes:result.copy!.scenes.map(s=>({...s,caption:'This fixture is not a real product advertisement.'}))};
    await expect(e.store.revise(result.id,result.version-1,revised,actor)).rejects.toMatchObject({code:'VERSION_CONFLICT'});
    result=await e.store.revise(result.id,result.version,revised,actor);expect(result.state).toBe('queued');expect(result.artifacts).toHaveLength(0);expect(result.reviewedBy).toBeUndefined();
    expect(result.steps.find(s=>s.key==='research')?.attempts).toBe(1);await e.tick();await e.tick();await e.tick();result=await e.store.get(result.id);expect(result.state).toBe('waiting_review');expect(result.copy?.title).toBe('Revised fixture');expect(result.steps.find(s=>s.key==='render')?.attempts).toBe(2);
  },120000);
});
