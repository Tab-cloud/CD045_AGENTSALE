import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAdminStaticServer,forwardAdminRequest} from '../scripts/admin-static-server.mjs';

describe('static administrator portal',()=>{
  afterEach(()=>vi.unstubAllGlobals());

  it('serves the built page and runtime member URL without a second Next server',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'lingfeng-admin-static-'));
    await writeFile(path.join(root,'index.html'),'<h1>聆风管理</h1>');
    const admin=createAdminStaticServer({port:0,backendUrl:'http://127.0.0.1:3045',environment:{LINGFENG_PUBLIC_URL:'https://members.example.com'},root});
    await admin.listen();
    const address=admin.server.address();
    const base=`http://127.0.0.1:${typeof address==='object'&&address?address.port:0}`;
    try{
      expect(await (await fetch(base)).text()).toContain('聆风管理');
      expect(await (await fetch(`${base}/config.json`)).json()).toEqual({memberUrl:'https://members.example.com'});
      expect((await fetch(`${base}/../private.txt`)).status).toBe(404);
    }finally{
      await new Promise<void>(resolve=>admin.server.close(()=>resolve()));
      await rm(root,{recursive:true,force:true});
    }
  });

  it('forwards only management services with the session cookie and trusted origin',async()=>{
    const upstream=vi.fn(async (_url:string,options:RequestInit)=>{
      expect(options.headers).toBeInstanceOf(Headers);
      const headers=options.headers as Headers;
      expect(headers.get('origin')).toBe('https://members.example.com');
      expect(headers.get('cookie')).toBe('lingfeng_session='+'A'.repeat(40));
      return new Response('{"ok":true}',{headers:{'Content-Type':'application/json','Set-Cookie':'lingfeng_session=renewed; Path=/; HttpOnly'}});
    });
    vi.stubGlobal('fetch',upstream);
    const env={LINGFENG_ADMIN_URL:'https://admin.example.com',LINGFENG_PUBLIC_URL:'https://members.example.com',AGENTSALE_BACKEND_URL:'http://127.0.0.1:3045'};
    const headers={host:'admin.example.com',origin:'https://admin.example.com',cookie:'lingfeng_session='+'A'.repeat(40)};
    const allowed=await forwardAdminRequest(new Request('https://admin.example.com/api/v1/auth',{method:'POST',headers,body:'{}'}),env);
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('set-cookie')).toContain('lingfeng_session=renewed');
    expect(upstream).toHaveBeenCalledTimes(1);
    expect((await forwardAdminRequest(new Request('https://admin.example.com/api/v1/automation',{headers}),env)).status).toBe(404);
    expect((await forwardAdminRequest(new Request('https://admin.example.com/api/v1/auth',{method:'POST',headers:{...headers,origin:'https://evil.example'},body:'{}'}),env)).status).toBe(403);
    expect((await forwardAdminRequest(new Request('https://members.example.com/api/v1/auth',{headers:{...headers,host:'members.example.com'}}),env)).status).toBe(403);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
