import type {Settings} from '@agentsale/automation';

export type ModelPreset = {
  id: string;
  label: string;
  description: string;
  protocol: Settings['protocol'];
  baseUrl: string;
  model: string;
  format: Settings['format'];
};

// These are starting values for the existing Chat Completions integration,
// not a server-side provider registry. Administrators can edit every field.
export const modelPresets: readonly ModelPreset[] = [
  {
    id: 'minimax', label: 'MiniMax', description: '国内接口；M3 使用提示词 JSON，推理内容与正文分离。',
    protocol: 'minimax', baseUrl: 'https://api.minimax.cn/v1', model: 'MiniMax-M3', format: 'prompt_json',
  },
  {
    id: 'deepseek', label: 'DeepSeek', description: '官方兼容接口；默认使用 JSON 模式。',
    protocol: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', format: 'json_object',
  },
  {
    id: 'qwen', label: '阿里云百炼 · 通义千问', description: '北京地域通用地址；其他地域或专属域名可手动修改。',
    protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', format: 'json_object',
  },
  {
    id: 'glm', label: '智谱 · GLM', description: '官方兼容接口；默认用提示词 JSON，结构化输出方式可手动调整。',
    protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.5', format: 'prompt_json',
  },
  {
    id: 'mimo', label: '小米 · MiMo', description: '按量付费接口；如使用 Token Plan，请替换为套餐专属地址与密钥。',
    protocol: 'openai', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.6-pro', format: 'json_object',
  },
  {
    id: 'volcengine', label: '火山引擎 · 豆包', description: '火山方舟北京地域接口；模型 ID 和地域可按已开通的服务调整。',
    protocol: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-2-1-pro-260628', format: 'prompt_json',
  },
];

export function matchingModelPreset(settings:Pick<Settings,'protocol'|'baseUrl'|'model'|'format'|'localModel'>):string {
  if(settings.localModel)return 'custom';
  return modelPresets.find(preset=>preset.protocol===settings.protocol&&preset.baseUrl.replace(/\/$/,'')===settings.baseUrl.replace(/\/$/,'')&&preset.model===settings.model&&preset.format===settings.format)?.id??'custom';
}
