'use client';
import {useState,type FormEvent} from 'react';
import {platformRequest} from '../../console/components/platform-account';

type PaymentChannel={
  enabled:boolean;appId:string;merchantId:string;privateKey:string;publicKey:string;
  serial:string;publicKeyId:string;apiV3Key:string;
  hasPrivateKey:boolean;hasPublicKey:boolean;hasApiV3Key:boolean;
};
export type PaymentConfiguration={revision:string;publicUrl:string;wechat:PaymentChannel;alipay:PaymentChannel};
type ChannelName='wechat'|'alipay';

export function PaymentEditor({initial}:{initial:PaymentConfiguration}){
  const [saved,setSaved]=useState(initial);
  const [draft,setDraft]=useState(initial);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  function change(name:ChannelName,key:keyof PaymentChannel,value:string|boolean){
    setDraft(current=>({...current,[name]:{...current[name],[key]:value}}));
    setNotice('');
  }
  function retained(name:ChannelName,key:'hasPrivateKey'|'hasPublicKey'|'hasApiV3Key'){
    const current=draft[name],previous=saved[name];
    return current.appId===previous.appId&&current.merchantId===previous.merchantId&&previous[key];
  }
  function status(name:ChannelName,key:'privateKey'|'publicKey'|'apiV3Key',flag:'hasPrivateKey'|'hasPublicKey'|'hasApiV3Key'){
    return draft[name][key]?'待保存':retained(name,flag)?'已填写':'未填写';
  }
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const clean=(channel:PaymentChannel)=>{const {hasPrivateKey:_,hasPublicKey:__,hasApiV3Key:___,...value}=channel;return value;};
      const result=await platformRequest('membership-admin',{action:'payment',revision:saved.revision,config:{publicUrl:draft.publicUrl.trim(),wechat:clean(draft.wechat),alipay:clean(draft.alipay)}}) as PaymentConfiguration;
      setSaved(result);setDraft(result);setNotice('支付配置已保存。刷新页面后，启用状态和已填写标记仍会保留。');
    }catch(cause){setError(cause instanceof Error?cause.message:'支付配置未保存，请检查填写内容');}
    finally{setBusy(false);}
  }
  function channel(name:ChannelName){
    const c=draft[name],alipay=name==='alipay';
    const privateStatus=status(name,'privateKey','hasPrivateKey'),publicStatus=status(name,'publicKey','hasPublicKey');
    return <fieldset key={name}>
      <legend>{alipay?'支付宝当面付':'微信 Native 扫码支付'} · {saved[name].enabled?'当前已启用':'当前未启用'}{c.enabled!==saved[name].enabled?' · 待保存':''}</legend>
      <label><input type="checkbox" checked={c.enabled} onChange={event=>change(name,'enabled',event.target.checked)}/>启用支付</label>
      <div className="billing-grid">
        <label>应用 App ID<input value={c.appId} required={c.enabled} onChange={event=>change(name,'appId',event.target.value)}/></label>
        <label>{alipay?'卖家用户 ID（seller_id）':'商户号（mchid）'}<input value={c.merchantId} required={c.enabled} onChange={event=>change(name,'merchantId',event.target.value)}/></label>
      </div>
      <label>{alipay?'应用私钥':'商户私钥'} <span className="payment-key-status">{privateStatus}</span>
        <textarea autoComplete="off" value={c.privateKey} required={c.enabled&&!retained(name,'hasPrivateKey')} placeholder={retained(name,'hasPrivateKey')?'已安全保存；留空保留':'粘贴 PEM 或原始 Base64 私钥'} onChange={event=>change(name,'privateKey',event.target.value)}/>
      </label>
      <label>{alipay?'支付宝公钥（不是应用公钥）':'微信支付公钥'} <span className="payment-key-status">{publicStatus}</span>
        <textarea value={c.publicKey} required={c.enabled&&!retained(name,'hasPublicKey')} placeholder={retained(name,'hasPublicKey')?'已安全保存；留空保留':'粘贴 PEM 或原始 Base64 公钥'} onChange={event=>change(name,'publicKey',event.target.value)}/>
      </label>
      {alipay?<p className="payment-field-help">应用公钥需上传到支付宝开放平台；这里填写支付宝开放平台返回的「支付宝公钥」，用于验证支付响应。</p>:<>
        <div className="billing-grid">
          <label>商户 API 证书序列号<input value={c.serial} required={c.enabled} onChange={event=>change(name,'serial',event.target.value)}/></label>
          <label>微信支付公钥 ID<input value={c.publicKeyId} required={c.enabled} onChange={event=>change(name,'publicKeyId',event.target.value)}/></label>
        </div>
        <label>APIv3 密钥 <span className="payment-key-status">{status(name,'apiV3Key','hasApiV3Key')}</span>
          <input type="password" autoComplete="new-password" value={c.apiV3Key} required={c.enabled&&!retained(name,'hasApiV3Key')} placeholder={retained(name,'hasApiV3Key')?'已安全保存；留空保留':'填写 32 字节 APIv3 密钥'} onChange={event=>change(name,'apiV3Key',event.target.value)}/>
        </label>
      </>}
      <p>回调：{draft.publicUrl||'https://你的会员站点'}/api/v1/payments/{name}</p>
    </fieldset>;
  }
  return <details className="payment-settings"><summary>微信 / 支付宝商户配置 · 支付宝{saved.alipay.enabled?'已启用':'未启用'}</summary>
    <form onSubmit={event=>void submit(event)}>
      <p>配置提交后由服务端校验并加密保存。公钥和私钥只显示填写状态；更换 App ID 或商户号时，需要重新填写对应密钥。</p>
      <label>会员站点公网 HTTPS 地址<input type="url" required={draft.wechat.enabled||draft.alipay.enabled} value={draft.publicUrl} placeholder="https://lingfeng.zailink.space" onChange={event=>{setDraft(current=>({...current,publicUrl:event.target.value}));setNotice('');}}/></label>
      {channel('wechat')}{channel('alipay')}
      <div className="payment-actions"><button type="submit" className="account-primary" disabled={busy}>{busy?'保存中…':'保存支付配置'}</button>
        {notice&&<span role="status" className="payment-feedback success">{notice}</span>}
        {error&&<span role="alert" className="payment-feedback error">未保存：{error}</span>}
      </div>
    </form>
  </details>;
}
