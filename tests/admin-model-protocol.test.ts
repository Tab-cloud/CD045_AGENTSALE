import {expect,it} from 'vitest';
import {modelPresets,protocolForModelEndpoint} from '../admin-console/components/model-presets';

it('uses MiniMax request handling only for official MiniMax HTTPS endpoints',()=>{
  expect(protocolForModelEndpoint(modelPresets.find(preset=>preset.id==='minimax')!.baseUrl)).toBe('minimax');
  expect(protocolForModelEndpoint('https://api.minimaxi.com/v1')).toBe('minimax');
  expect(protocolForModelEndpoint('https://api.minimax.io/v1')).toBe('minimax');
  expect(protocolForModelEndpoint('https://api.minimax.cn.evil.example/v1')).toBe('openai');
  expect(protocolForModelEndpoint('http://api.minimax.cn/v1')).toBe('openai');
  for(const preset of modelPresets.filter(preset=>preset.id!=='minimax')){
    expect(protocolForModelEndpoint(preset.baseUrl)).toBe('openai');
  }
});
