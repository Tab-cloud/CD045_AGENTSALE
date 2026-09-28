import { createRepository, LOCAL_WORKSPACE, type Repository } from '@agentsale/database';
import { DomainError } from '@agentsale/domain';
import { createAutomation,FlowError } from '@agentsale/automation';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const runtime = globalThis as typeof globalThis & { agentsaleRepository?: Promise<Repository>; agentsaleTimer?: ReturnType<typeof setInterval>; agentsaleBusy?: boolean; agentsaleAutomation?: ReturnType<typeof createAutomation> };
export function requireLocal(request: Request, mutation = false) {
  const url = new URL(request.url);
  // Next reconstructs request.url using its internal hostname. The HTTP Host
  // header retains the browser's authority; validate it before comparing Origin.
  let browserUrl: URL;
  try { browserUrl = new URL(`${url.protocol}//${request.headers.get('host') || url.host}`); }
  catch { throw new DomainError('LOCAL_ONLY', '无效的本机地址', 403); }
  if (process.env.AGENTSALE_LOCAL_DEMO !== '1' || !['127.0.0.1', 'localhost', '[::1]'].includes(browserUrl.hostname) || browserUrl.username || browserUrl.password) {
    throw new DomainError('LOCAL_ONLY', '本批应用仅供本机演练，正式部署需完成身份与服务接入', 403);
  }
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new DomainError('ORIGIN_REJECTED', '不接受跨站请求', 403);
  if (mutation && request.headers.get('origin') !== browserUrl.origin) throw new DomainError('ORIGIN_REJECTED', '请从当前应用页面提交操作', 403);
}
export async function getRepository() {
  if (!runtime.agentsaleRepository) {
    runtime.agentsaleRepository = (async () => {
      if (process.env.AGENTSALE_LOCAL_DEMO !== '1' && !process.env.LINGFENG_PUBLIC_URL) throw new DomainError('LOCAL_ONLY', '本地演练尚未启用', 403);
      const dataDir = process.env.AGENTSALE_DATA_DIR;
      if (!dataDir) throw new DomainError('DATA_DIR_REQUIRED', '请使用项目根目录的启动命令，以配置本地数据目录', 503);
      await mkdir(dataDir, { recursive: true });
      const repository = await createRepository(dataDir);
      if(!process.env.LINGFENG_PUBLIC_URL)await repository.seed();
      runtime.agentsaleAutomation=createAutomation(repository,LOCAL_WORKSPACE,path.join(path.dirname(dataDir),'automation'));
      await runtime.agentsaleAutomation.store.recover();
      if (process.env.LINGFENG_LEGACY_ADMIN_WORKER === '1' && !runtime.agentsaleTimer) {
        runtime.agentsaleTimer = setInterval(async () => {
          if (runtime.agentsaleBusy) return;
          runtime.agentsaleBusy = true;
          try { await repository.processOne(LOCAL_WORKSPACE); await runtime.agentsaleAutomation?.tick(); await runtime.agentsaleAutomation?.agentTick(); }
          catch (error) { console.error('Local task processing failed:', error instanceof Error ? error.message : 'unknown'); }
          finally { runtime.agentsaleBusy = false; }
        }, 1500);
        runtime.agentsaleTimer.unref();
      }
      return repository;
    })().catch(error => { runtime.agentsaleRepository = undefined; throw error; });
  }
  return runtime.agentsaleRepository;
}
export async function getAutomation(){await getRepository();return runtime.agentsaleAutomation!;}
export function failure(error: unknown) {
  if (DomainError.is(error)) return Response.json({ code: error.code, message: error.message }, { status: error.status });
  if (FlowError.is(error)) return Response.json({code:error.code,message:error.message},{status:422});
  console.error('Local operation failed:', error instanceof Error ? error.message : 'unknown');
  return Response.json({ code: 'LOCAL_OPERATION_FAILED', message: '本地操作未完成，请稍后重试。已保存的数据不会因此清空。' }, { status: 500 });
}
