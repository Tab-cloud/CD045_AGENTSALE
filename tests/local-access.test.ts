import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireLocal } from '../console/lib/local-runtime';
import {access} from '../console/lib/server-access';
const original=process.env.AGENTSALE_LOCAL_DEMO;
beforeEach(()=>{process.env.AGENTSALE_LOCAL_DEMO='1';});
afterEach(()=>{if(original===undefined)delete process.env.AGENTSALE_LOCAL_DEMO;else process.env.AGENTSALE_LOCAL_DEMO=original;});
describe('本机演练入口',()=>{
  it('使用已验证的 HTTP Host 处理框架内部主机名差异',()=>{
    const url='http://localhost:3045/api/v1/commands';
    expect(()=>requireLocal(new Request(url,{headers:{host:'127.0.0.1:3045',origin:'http://127.0.0.1:3045'}}),true)).not.toThrow();
    expect(()=>requireLocal(new Request(url,{headers:{host:'attacker.example',origin:'http://attacker.example'}}),true)).toThrow();
    expect(()=>requireLocal(new Request(url,{headers:{host:'127.0.0.1:3045',origin:'http://localhost:3045'}}),true)).toThrow();
  });
  it('要求显式启用本地模式',()=>{delete process.env.AGENTSALE_LOCAL_DEMO;expect(()=>requireLocal(new Request('http://127.0.0.1:3045/api/v1/state'))).toThrow();});
  it('拒绝远程 Host 和跨站读取',()=>{expect(()=>requireLocal(new Request('http://public.example/api/v1/state'))).toThrow();expect(()=>requireLocal(new Request('http://127.0.0.1:3045/api/v1/state',{headers:{'sec-fetch-site':'cross-site'}}))).toThrow();});
  it('写操作要求同源 Origin',()=>{const url='http://127.0.0.1:3045/api/v1/commands';expect(()=>requireLocal(new Request(url),true)).toThrow();expect(()=>requireLocal(new Request(url,{headers:{origin:'https://other.example'}}),true)).toThrow();expect(()=>requireLocal(new Request(url,{headers:{origin:'http://127.0.0.1:3045'}}),true)).not.toThrow();});
  it('公网服务不执行旧 Web 业务任务',async()=>{
    const previous=process.env.LINGFENG_PUBLIC_URL;
    process.env.LINGFENG_PUBLIC_URL='https://members.example.com';
    try{await expect(access(new Request('https://members.example.com/api/v1/automation'))).rejects.toMatchObject({code:'LEGACY_API_DISABLED',status:404});}
    finally{if(previous===undefined)delete process.env.LINGFENG_PUBLIC_URL;else process.env.LINGFENG_PUBLIC_URL=previous;}
  });
});
