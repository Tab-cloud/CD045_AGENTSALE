// Explicit QA profile only. Never run against the user's normal workspace.
import sharp from 'sharp';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
const base='http://127.0.0.1:3046';
async function login(username,password){const response=await fetch(base+'/api/v1/auth',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({action:'login',username,password})});if(!response.ok)throw new Error('QA login failed');return response.headers.get('set-cookie').split(';')[0];}
const admin=await login('qa-admin','TestOnly-Flow-20260906');
const operator=await login('qa-operator','TestOnly-Operator-20260906');
const unauthenticated=await fetch(base+'/api/v1/state');
const adminBusinessRead=await fetch(base+'/api/v1/state',{headers:{Cookie:admin}});
const readAdmin=await fetch(base+'/api/v1/admin',{headers:{Cookie:operator}});
const writeAdmin=await fetch(base+'/api/v1/admin',{method:'POST',headers:{Cookie:operator,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({action:'verify'})});
if(unauthenticated.status!==401||adminBusinessRead.status!==403||readAdmin.status!==403||writeAdmin.status!==403)throw new Error('Role boundary failed');
const snapshot=await (await fetch(base+'/api/v1/state',{headers:{Cookie:operator}})).json();const product=snapshot.products.find(p=>p.sku==='DEMO-001');
const svg='<svg width="720" height="800" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="800" fill="#f5f5f7"/><rect x="200" y="190" width="320" height="380" rx="30" fill="#bec6ce"/><rect x="235" y="215" width="250" height="325" rx="16" fill="#dce1e5"/><path d="M300 570h120l50 90H250z" fill="#a4aeb8"/><text x="360" y="95" text-anchor="middle" font-size="30" font-family="Arial" fill="#333">QA TEST ASSET</text><text x="360" y="745" text-anchor="middle" font-size="19" font-family="Arial" fill="#666">Synthetic fixture - not a product photo</text></svg>';
const png=await sharp(Buffer.from(svg)).png().toBuffer();
const response=await fetch(base+'/api/v1/media',{method:'POST',headers:{Cookie:operator,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({productId:product.id,name:'qa-test-asset.png',rights:'Synthetic QA fixture created in this test, not an actual product photo',base64:png.toString('base64')})});
const media=await response.json();if(!response.ok)throw new Error('Asset upload failed: '+media.message);
const dir=path.resolve('docs/reports/artifacts/automation-v0.2');await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'qa-source.png'),png);
const report={environment:'isolated QA profile on port 3046',unauthenticatedStatus:unauthenticated.status,adminBusinessRead:adminBusinessRead.status,operatorAdminRead:readAdmin.status,operatorAdminWrite:writeAdmin.status,mediaUpload:response.status,assetId:media.asset.id,productId:product.id,createdAt:new Date().toISOString()};
await writeFile(path.join(dir,'http-access-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
