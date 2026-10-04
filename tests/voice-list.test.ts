import {expect,it} from 'vitest';
import {appendVoices} from '../admin-console/components/voice-list';
import {defaults,settingsSchema} from '../packages/automation/src/types';

it('adds every discovered voice without replacing manual entries or duplicating IDs',()=>{
  const manual='manual-id | 手工音色\nvoice-0 | 已配置名称';
  const official=Array.from({length:150},(_,index)=>({id:`voice-${index}`,name:`官方音色 ${index}`}));
  official.push({id:'voice-1',name:'重复项'});
  const merged=appendVoices(manual,official);
  expect(merged.added).toBe(149);
  expect(merged.value.startsWith(manual+'\n')).toBe(true);
  expect(merged.value.split('\n')).toHaveLength(151);
  expect(merged.value).toContain('voice-149 | 官方音色 149');
  expect(appendVoices(merged.value,official)).toEqual({value:merged.value,added:0});
  const voices=merged.value.split('\n').map(line=>{const [id,name]=line.split('|').map(part=>part.trim());return {id,name};});
  expect(settingsSchema.safeParse({...defaults,minimax:{...defaults.minimax,voices}}).success).toBe(true);
});

it('keeps manually entered text readable when provider names contain separators',()=>{
  expect(appendVoices('',[{id:'voice-a',name:'A | B\nC'}])).toEqual({value:'voice-a | A   B C',added:1});
});
