import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {validUrl} from './network';
import {FlowError,type SecretSettings} from './types';

export function assertProvider(config:SecretSettings,verified=true){
  if(!config.model)throw new FlowError('MODEL_UNCONFIGURED','请管理员配置模型名称和接口');
  const endpoint=validUrl(config.baseUrl,config.localModel);
  if(!config.localModel&&endpoint.protocol!=='https:')throw new FlowError('MODEL_UNCONFIGURED','远程模型接口必须使用 HTTPS');
  if(!config.localModel&&!config.apiKey)throw new FlowError('MODEL_UNCONFIGURED','尚未保存模型 API 密钥');
  if(verified&&(!config.verifiedAt||Date.now()-Date.parse(config.verifiedAt)>86400000))throw new FlowError('MODEL_UNVERIFIED','模型尚未验证或验证已过期，请管理员测试连接');
}
export async function verifyModel(config:SecretSettings,providerId:'standard'|'minimax'='standard'){
  if(providerId==='standard')assertProvider(config,false);
  const {generateText}=await import('./model-gateway');
  const schema=z.object({ready:z.literal(true)}).strict();
  const result=await generateText(config,{action:'text.generate',providerId,id:randomUUID(),messages:[{role:'user',content:'Return exactly {"ready":true} as JSON.'}],jsonSchema:z.toJSONSchema(schema)});
  const text=result.text.replace(/^```(?:json)?\s*|\s*```$/g,'').trim();
  try{schema.parse(JSON.parse(text));}catch{throw new FlowError('MODEL_VERIFY','模型未返回要求的结构化测试结果');}
  return {model:result.model,usage:result.usage};
}
