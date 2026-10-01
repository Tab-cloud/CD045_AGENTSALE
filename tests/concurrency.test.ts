import {expect,it} from 'vitest';
import {ConcurrencyGate,busyResponse} from '../console/lib/concurrency';

it('caps model work across lanes and per member without retaining released slots',()=>{
  const gate=new ConcurrencyGate();
  const sameUser=[gate.tryAcquire('text','member-a'),gate.tryAcquire('image','member-a')];
  expect(sameUser.every(Boolean)).toBe(true);
  expect(gate.tryAcquire('audio','member-a')).toBeNull();
  const others=Array.from({length:4},(_,index)=>gate.tryAcquire('text','member-'+index));
  // Text has its own three-slot ceiling, independent of the six-slot model pool.
  expect(others.filter(Boolean)).toHaveLength(2);
  const media=[gate.tryAcquire('image','member-b'),gate.tryAcquire('videoSubmit','member-c')];
  expect(media.every(Boolean)).toBe(true);
  expect(gate.tryAcquire('videoPoll','member-d')).toBeNull();
  // Release every acquired slot before checking that the pool can be reused.
  [...sameUser,...others,...media].forEach(release=>release?.());
  expect(gate.tryAcquire('text','member-a')).not.toBeNull();
});

it('allows one video poll per task, and reserves SMS and payment capacity separately',()=>{
  const gate=new ConcurrencyGate();
  const first=gate.tryAcquire('videoPoll','member-a','task-1');
  expect(first).not.toBeNull();
  expect(gate.tryAcquire('videoPoll','member-a','task-1')).toBeNull();
  expect(gate.tryAcquire('videoPoll','member-b','task-2')).toBeNull();
  const sms=gate.tryAcquire('sms');
  expect(sms).not.toBeNull();
  expect(gate.tryAcquire('sms')).toBeNull();
  const payment=gate.tryAcquire('payment',undefined,'order-1');
  expect(payment).not.toBeNull();
  expect(gate.tryAcquire('payment',undefined,'order-1')).toBeNull();
  first?.();first?.();sms?.();payment?.();
  expect(gate.tryAcquire('videoPoll','member-a','task-1')).not.toBeNull();
  expect(gate.tryAcquire('sms')).not.toBeNull();
});

it('bounds large request parsing before the provider admission stage',()=>{
  const gate=new ConcurrencyGate();
  const first=gate.tryAcquire('modelInput','member-a'),second=gate.tryAcquire('modelInput','member-a');
  expect(first&&second).toBeTruthy();
  expect(gate.tryAcquire('modelInput','member-a')).toBeNull();
  first?.();second?.();
  expect(gate.tryAcquire('modelInput','member-a')).not.toBeNull();
});

it('keeps text subscriptions separate from provider work while bounding open streams',()=>{
  const gate=new ConcurrencyGate();
  const streams=Array.from({length:4},()=>gate.tryAcquire('textStream','member-a'));
  expect(streams.every(Boolean)).toBe(true);
  expect(gate.tryAcquire('textStream','member-a')).toBeNull();
  const modelWork=[gate.tryAcquire('text','member-a'),gate.tryAcquire('image','member-a')];
  expect(modelWork.every(Boolean)).toBe(true);
  expect(gate.tryAcquire('audio','member-a')).toBeNull();
  [...streams,...modelWork].forEach(release=>release?.());
  expect(gate.tryAcquire('textStream','member-a')).not.toBeNull();
});

it('returns an explicit retry response when capacity is exhausted',async()=>{
  const response=busyResponse();
  expect(response.status).toBe(429);
  expect(response.headers.get('Retry-After')).toBe('5');
  expect(await response.json()).toMatchObject({code:'SERVICE_BUSY'});
});
