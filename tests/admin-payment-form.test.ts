import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {PaymentEditor,type PaymentConfiguration} from '../admin-console/components/payment-editor';

it('shows saved Alipay fields after reload without exposing either key',()=>{
  const empty={enabled:false,appId:'',merchantId:'',privateKey:'',publicKey:'',serial:'',publicKeyId:'',apiV3Key:'',hasPrivateKey:false,hasPublicKey:false,hasApiV3Key:false};
  const initial:PaymentConfiguration={revision:'stored-revision',publicUrl:'https://members.example.com',wechat:{...empty},alipay:{...empty,enabled:true,appId:'app-fixture',merchantId:'seller-fixture',hasPrivateKey:true,hasPublicKey:true}};
  const html=renderToStaticMarkup(createElement(PaymentEditor,{initial}));
  expect(html).toContain('支付宝网页支付（电脑 / 手机） · 当前已启用');
  expect(html).toContain('app-fixture');
  expect(html).toContain('seller-fixture');
  expect(html.match(/已填写/g)).toHaveLength(2);
  expect(html).toContain('支付宝公钥（不是应用公钥）');
  expect(html).not.toContain('private-key-fixture');
});
