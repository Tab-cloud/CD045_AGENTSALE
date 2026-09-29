// Explicit isolated QA verification. Never run against the normal workspace.
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const base='http://127.0.0.1:3046',origin={Origin:base,'Content-Type':'application/json'};
const login=await fetch(base+'/api/v1/auth',{method:'POST',headers:origin,body:JSON.stringify({action:'login',username:'qa-operator',password:'TestOnly-Operator-20260906'})});
if(!login.ok)throw new Error('QA operator login failed');const cookie=login.headers.get('set-cookie').split(';')[0];
async function command(body){const response=await fetch(base+'/api/v1/commands',{method:'POST',headers:{...origin,Cookie:cookie,'Idempotency-Key':randomUUID()},body:JSON.stringify(body)}),result=await response.json();if(!response.ok)throw new Error(result.message||'QA command failed');return result;}
const suffix=Date.now().toString().slice(-8),created=await command({type:'product.create',name:'决策层验收商品',sku:'DECISION-'+suffix,supplier:'验收工厂',region:'中国大陆',market:'美国',description:'仅用于隔离环境验证决策评分',sourceUrl:'https://example.com/decision-qa',costs:{currency:'USD',revenueMinor:2990,procurementCnyMinor:4464,cnyPerUsdMillion:7200000,fxDate:'2026-09-06',shippingMinor:560,feeMinor:150,afterSaleMinor:100,mediaMinor:60,acquisitionMinor:600}});
await command({type:'evidence.add',productId:created.id,expectedVersion:1,title:'验收供货资料',url:'https://example.com/decision-qa/evidence',note:'合成验收资料，仅用于测试人工确认门槛。',confirmed:true});
const common={platform:'tiktok_shop',country:'美国',sourceType:'authorized_export',sourceRef:'隔离 QA 授权导出模拟数据',reviewCount:1200,ratingHundredths:470,engagementRateBps:450,competitorCount:8,medianPriceMinor:3290,deliveryDays:8,refundRateBps:350,notes:'合成指标，不代表真实平台表现'};
await command({type:'market.snapshot.add',productId:created.id,expectedProductVersion:2,signal:{...common,observedAt:'2026-09-01',unitsSold7d:100,views7d:250000}});
await command({type:'market.snapshot.add',productId:created.id,expectedProductVersion:2,signal:{...common,observedAt:'2026-09-06',unitsSold7d:180,views7d:500000}});
const response=await fetch(base+'/api/v1/state',{headers:{Cookie:cookie}}),snapshot=await response.json();if(!response.ok)throw new Error('QA state failed');
const decision=snapshot.decisions.find(item=>item.productId===created.id&&item.platform==='tiktok_shop');
if(!decision||decision.recommendation!=='sample_test'||decision.trend.unitsSoldChangePercent!==80||decision.trend.viewsChangePercent!==100)throw new Error('Decision result failed');
const report={environment:'isolated QA profile on port 3046',productId:created.id,signalCount:snapshot.marketSignals.filter(item=>item.productId===created.id).length,recommendation:decision.recommendation,overallScore:decision.overallScore,confidencePercent:decision.confidencePercent,trend:decision.trend,dimensionScores:Object.fromEntries(Object.entries(decision.dimensions).map(([name,value])=>[name,value.score])),verifiedAt:new Date().toISOString()};
const directory=path.resolve('docs/reports/artifacts/decision-v0.5');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'http-check.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
