import React from 'react';
import {createRoot} from 'react-dom/client';
import '@agentsale/ui/tokens.css';
import '../../console/app/account.css';
import './admin.css';
import {AdminApp} from '../components/admin-app';

async function start(){
  const response=await fetch('/config.json',{cache:'no-store'});
  if(!response.ok)throw new Error('管理站点配置不可用');
  const {memberUrl}=await response.json() as {memberUrl:string};
  createRoot(document.getElementById('root')!).render(<AdminApp operatorUrl={memberUrl}/>);
}

void start().catch(error=>{
  document.getElementById('root')!.textContent=error instanceof Error?error.message:'管理站点暂时不可用';
});
