import {createModelMedia} from '../../packages/automation/src/model-media';
import {modelRoot} from './local-runtime';

const state=globalThis as typeof globalThis & {lingfengModelMedia?:ReturnType<typeof createModelMedia>};
export async function modelMediaService(){
  if(!state.lingfengModelMedia)state.lingfengModelMedia=createModelMedia(modelRoot());
  return state.lingfengModelMedia;
}
