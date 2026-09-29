// The Web deployment runs one Next process. Keep admission synchronous so a
// rejected request never reserves quota or starts a paid provider operation.
export type Lane = 'modelInput' | 'text' | 'image' | 'videoSubmit' | 'videoPoll' | 'audio' | 'asset' | 'sms' | 'payment';
const modelLanes = new Set<Lane>(['text', 'image', 'videoSubmit', 'videoPoll', 'audio', 'asset']);
const limits: Record<Lane, number> = {modelInput: 8, text: 3, image: 2, videoSubmit: 2, videoPoll: 1, audio: 2, asset: 2, sms: 1, payment: 2};

export class ConcurrencyGate {
  private readonly active = new Map<string, number>();
  private readonly tasks = new Set<string>();

  tryAcquire(lane: Lane, userId?: string, taskId?: string): (() => void) | null {
    const keys: string[] = [lane];
    if (modelLanes.has(lane)) {
      keys.push('model');
      if (userId) keys.push('model:user:' + userId);
    }
    if (lane === 'modelInput' && userId) keys.push('modelInput:user:' + userId);
    const task = taskId ? lane + ':task:' + taskId : undefined;
    if (task && this.tasks.has(task)) return null;
    if (keys.some(key => (this.active.get(key) || 0) >= (key === 'model' ? 6 : key.startsWith('model:user:') || key.startsWith('modelInput:user:') ? 2 : limits[lane]))) return null;
    for (const key of keys) this.active.set(key, (this.active.get(key) || 0) + 1);
    if (task) this.tasks.add(task);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const key of keys) {
        const next = this.active.get(key)! - 1;
        if (next) this.active.set(key, next);
        else this.active.delete(key);
      }
      if (task) this.tasks.delete(task);
    };
  }
}

const state = globalThis as typeof globalThis & {lingfengConcurrencyGate?: ConcurrencyGate};
export const concurrencyGate = state.lingfengConcurrencyGate ??= new ConcurrencyGate();
export function busyResponse() {
  return Response.json({code: 'SERVICE_BUSY', message: '当前请求较多，请稍后重试；本次未开始执行'}, {
    status: 429,
    headers: {'Retry-After': '5', 'Cache-Control': 'no-store'},
  });
}
