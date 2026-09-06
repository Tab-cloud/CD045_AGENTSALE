// Explicit isolated QA verification for the two local portals.
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
const operatorBase='http://127.0.0.1:3046',adminBase='http://127.0.0.1:3048';
async function login(base,username,password){const response=await fetch(base+'/api/v1/auth',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({action:'login',username,password})});if(!response.ok)throw new Error('QA portal login failed');return response.headers.get('set-cookie').split(';')[0];}
const operator=await login(operatorBase,'qa-operator','TestOnly-Operator-20260906'),admin=await login(adminBase,'qa-admin','TestOnly-Flow-20260906');
const checks={
  operatorBusiness:(await fetch(operatorBase+'/api/v1/state',{headers:{Cookie:operator}})).status,
  operatorManagement:(await fetch(operatorBase+'/api/v1/admin',{headers:{Cookie:operator}})).status,
  adminManagementViaPortal:(await fetch(adminBase+'/api/v1/admin',{headers:{Cookie:admin}})).status,
  adminBusinessDirect:(await fetch(operatorBase+'/api/v1/state',{headers:{Cookie:admin}})).status,
  adminPortalBusinessProxy:(await fetch(adminBase+'/api/v1/state',{headers:{Cookie:admin}})).status
};
if(checks.operatorBusiness!==200||checks.operatorManagement!==403||checks.adminManagementViaPortal!==200||checks.adminBusinessDirect!==403||checks.adminPortalBusinessProxy!==404)throw new Error('Portal role separation failed');
const report={environment:'isolated QA portals',operatorUrl:operatorBase,administratorUrl:adminBase,checks,verifiedAt:new Date().toISOString()};
const directory=path.resolve('docs/reports/artifacts/portal-separation-v0.4');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'http-role-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
