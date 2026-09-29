import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createRepository,type Repository} from '../packages/database/src/index';
import {createAuth} from '../packages/automation/src/auth';

let repo:Repository;
beforeAll(async()=>{repo=await createRepository();},30000);
afterAll(async()=>{await repo?.close();});

describe('desktop browser sign in',()=>{
  it('issues a separate desktop session only after browser approval and a matching code',async()=>{
    const auth=createAuth(repo,randomUUID());
    const user=await auth.create('desktop-member','long-test-password','admin');
    const link=await auth.beginDesktopLogin('one-requester');
    expect(link.id).not.toContain(link.secret);
    expect(await auth.pollDesktopLogin(link.id,link.secret)).toEqual({status:'pending'});
    await expect(auth.pollDesktopLogin(link.id,'x'.repeat(43))).rejects.toThrow('无效');
    await expect(auth.approveDesktopLogin(link.id,link.code==='000000'?'000001':'000000',user.id)).rejects.toThrow('配对码');
    await auth.approveDesktopLogin(link.id,link.code,user.id);
    const result=await auth.pollDesktopLogin(link.id,link.secret);
    expect(result.status).toBe('approved');
    if(result.status!=='approved')throw new Error('Expected approval');
    expect(result.user.id).toBe(user.id);
    expect(await auth.require(result.token)).toMatchObject({id:user.id});
    await expect(auth.pollDesktopLogin(link.id,link.secret)).rejects.toThrow('失效');
  });
  it('locks a request after repeated wrong codes and supports cancellation',async()=>{
    const auth=createAuth(repo,randomUUID());
    const user=await auth.create('another-member','long-test-password','admin');
    const link=await auth.beginDesktopLogin('another-requester');
    const wrong=link.code==='999999'?'888888':'999999';
    for(let attempt=0;attempt<5;attempt++)await expect(auth.approveDesktopLogin(link.id,wrong,user.id)).rejects.toThrow('配对码');
    await expect(auth.approveDesktopLogin(link.id,link.code,user.id)).rejects.toThrow('失效');
    const next=await auth.beginDesktopLogin('another-requester');
    await auth.cancelDesktopLogin(next.id,next.secret);
    await expect(auth.approveDesktopLogin(next.id,next.code,user.id)).rejects.toThrow('失效');
  });
  it('counts completed connections toward the requester limit',async()=>{
    const auth=createAuth(repo,randomUUID());
    const user=await auth.create('limited-member','long-test-password','admin');
    const first=await auth.beginDesktopLogin('limited-requester');
    await auth.approveDesktopLogin(first.id,first.code,user.id);
    expect((await auth.pollDesktopLogin(first.id,first.secret)).status).toBe('approved');
    for(let attempt=1;attempt<10;attempt++){
      const link=await auth.beginDesktopLogin('limited-requester');
      await auth.cancelDesktopLogin(link.id,link.secret);
    }
    await expect(auth.beginDesktopLogin('limited-requester')).rejects.toThrow('频繁');
  });
  it('applies the requester limit when starts arrive together',async()=>{
    const auth=createAuth(repo,randomUUID());
    const results=await Promise.allSettled(Array.from({length:12},()=>auth.beginDesktopLogin('shared-requester')));
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(10);
    expect(results.filter(result=>result.status==='rejected')).toHaveLength(2);
  });
});
