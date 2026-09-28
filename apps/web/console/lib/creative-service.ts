import { createCreativeService } from '../../packages/automation/src/creative';
import { getAutomation } from './local-runtime';
const state = globalThis as typeof globalThis & { lingfengCreative?: ReturnType<typeof createCreativeService> };
const users=new Map<string,ReturnType<typeof createCreativeService>>();
export async function creativeService(owner?:string) {
  if(owner){if(!users.has(owner))users.set(owner,createCreativeService((await getAutomation()).root,undefined,owner));return users.get(owner)!;}
  if (!state.lingfengCreative) { const engine = await getAutomation(); state.lingfengCreative ??= createCreativeService(engine.root); }
  return state.lingfengCreative;
}
