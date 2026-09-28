import {it,expect,afterEach} from 'vitest';
import {generateKeyPairSync,sign,createCipheriv,randomBytes} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPayments,verifyWechat} from '../packages/automation/src/payment';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const {privateKey:alipayResponsePrivateKey,publicKey:alipayPublicKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const wx={enabled:true,appId:'wx-test',merchantId:'merchant-test',serial:'cert-test',publicKeyId:'PUB_KEY_ID_TEST',privateKey,publicKey,apiV3Key:'12345678901234567890123456789012'};
const ali={...wx,appId:'ali-test',merchantId:'seller-test',enabled:true,publicKey:alipayPublicKey,apiV3Key:''};
const dirs:string[]=[];afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
function signed(body:string,timestamp=Math.floor(Date.now()/1000).toString()){const nonce='nonce-test',signature=sign('RSA-SHA256',Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),privateKey).toString('base64');return new Headers({'wechatpay-timestamp':timestamp,'wechatpay-nonce':nonce,'wechatpay-serial':wx.publicKeyId,'wechatpay-signature':signature});}
it('rejects a payment configuration saved from an outdated administrator view',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'lingfeng-payment-'));dirs.push(root);
 const payments=createPayments(root),config={publicUrl:'',wechat:{...wx,enabled:false},alipay:{...ali,enabled:false}};
 const before=await payments.configuration();
 await payments.configure({...config,publicUrl:'https://first.example'},before.revision);
 await expect(payments.configure({...config,publicUrl:'https://stale.example'},before.revision)).rejects.toMatchObject({code:'CONFIG_CHANGED',status:409});
 expect((await payments.configuration()).publicUrl).toBe('https://first.example');
});
it('keeps Alipay enabled and masks both keys after saving and reopening configuration',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'lingfeng-payment-'));dirs.push(root);
 const payments=createPayments(root),before=await payments.configuration();
 const saved=await payments.configure({publicUrl:'https://members.example.com',wechat:{...wx,enabled:false},alipay:{...ali,privateKey:Buffer.from(privateKey.replace(/-----[^-]+-----|\s/g,''),'base64').toString('base64'),publicKey:alipayPublicKey.replace(/-----[^-]+-----|\s/g,'')}},before.revision);
 expect(saved.alipay).toMatchObject({enabled:true,appId:'ali-test',merchantId:'seller-test',privateKey:'',publicKey:'',hasPrivateKey:true,hasPublicKey:true});
 const reopened=await createPayments(root).configuration();
 expect(reopened.alipay).toMatchObject({enabled:true,appId:'ali-test',merchantId:'seller-test',privateKey:'',publicKey:'',hasPrivateKey:true,hasPublicKey:true});
 expect(JSON.stringify(reopened)).not.toContain(privateKey);
 const clean=(channel:typeof reopened.alipay)=>{const {hasPrivateKey:_,hasPublicKey:__,hasApiV3Key:___,...values}=channel;return values;};
 const updated=await payments.configure({publicUrl:reopened.publicUrl,wechat:clean(reopened.wechat),alipay:clean(reopened.alipay)},reopened.revision);
 expect(updated.alipay).toMatchObject({enabled:true,hasPrivateKey:true,hasPublicKey:true});
});
it('reports missing Alipay setup fields and rejects the application public key in the Alipay key field',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'lingfeng-payment-'));dirs.push(root);const payments=createPayments(root);
 await expect(payments.configure({publicUrl:'',wechat:{...wx,enabled:false},alipay:ali})).rejects.toThrow('公网 HTTPS 回调地址');
 await expect(payments.configure({publicUrl:'https://members.example.com',wechat:{...wx,enabled:false},alipay:{...ali,merchantId:''}})).rejects.toThrow('seller_id');
 await expect(payments.configure({publicUrl:'https://members.example.com',wechat:{...wx,enabled:false},alipay:{...ali,publicKey}})).rejects.toThrow('应用公钥');
 expect((await payments.configuration()).alipay.enabled).toBe(false);
});
it('rejects forged, old and unknown-key WeChat notifications',()=>{const body='{"test":true}',headers=signed(body);expect(()=>verifyWechat(wx,headers,body)).not.toThrow();expect(()=>verifyWechat(wx,headers,body+' ')).toThrow();expect(()=>verifyWechat(wx,signed(body,'1'),body)).toThrow();headers.set('wechatpay-serial','unknown');expect(()=>verifyWechat(wx,headers,body)).toThrow();});
it('requires the payment callback to match the deployed member origin',async()=>{const root=await mkdtemp(path.join(tmpdir(),'lingfeng-payment-'));dirs.push(root);const old=process.env.LINGFENG_PUBLIC_URL;process.env.LINGFENG_PUBLIC_URL='https://members.example.com';try{await expect(createPayments(root).configure({publicUrl:'https://other.example.com',wechat:wx,alipay:ali})).rejects.toThrow('会员站点');}finally{if(old===undefined)delete process.env.LINGFENG_PUBLIC_URL;else process.env.LINGFENG_PUBLIC_URL=old;}});
it('decrypts valid WeChat payment, verifies merchant and seals credentials',async()=>{const root=await mkdtemp(path.join(tmpdir(),'lingfeng-payment-'));dirs.push(root);const payments=createPayments(root);const safe=await payments.configure({publicUrl:'https://platform.example',wechat:wx,alipay:ali});expect(JSON.stringify(safe)).not.toContain(privateKey);expect((await readFile(path.join(root,'payments/config.sealed'))).includes(Buffer.from(wx.apiV3Key))).toBe(false);const make=(merchant:string)=>{const cipher=createCipheriv('aes-256-gcm',Buffer.from(wx.apiV3Key),Buffer.from('123456789012'));cipher.setAAD(Buffer.from('transaction'));const encrypted=Buffer.concat([cipher.update(JSON.stringify({mchid:merchant,appid:wx.appId,trade_state:'SUCCESS',amount:{total:123,currency:'CNY'},out_trade_no:'order',transaction_id:'tx'})),cipher.final(),cipher.getAuthTag()]);return JSON.stringify({event_type:'TRANSACTION.SUCCESS',resource:{algorithm:'AEAD_AES_256_GCM',nonce:'123456789012',associated_data:'transaction',ciphertext:encrypted.toString('base64')}});};const body=make(wx.merchantId);expect(await payments.notification('wechat',signed(body),body)).toEqual({id:'order',cents:123,transactionId:'tx'});const bad=make('another-merchant');await expect(payments.notification('wechat',signed(bad),bad)).rejects.toThrow();});
it('verifies Alipay signature, app, seller and amount; detects payload tampering',async()=>{const root=await mkdtemp(path.join(tmpdir(),'lingfeng-payment-'));dirs.push(root);const p=createPayments(root);await p.configure({publicUrl:'https://platform.example',wechat:wx,alipay:ali});const fields={app_id:ali.appId,seller_id:ali.merchantId,trade_status:'TRADE_SUCCESS',total_amount:'1.23',out_trade_no:'order',trade_no:'tx'};const canonical=Object.entries(fields).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('&');const body=new URLSearchParams({...fields,sign_type:'RSA2',sign:sign('RSA-SHA256',Buffer.from(canonical),alipayResponsePrivateKey).toString('base64')}).toString();expect(await p.notification('alipay',new Headers(),body)).toEqual({id:'order',cents:123,transactionId:'tx'});await expect(p.notification('alipay',new Headers(),body.replace('total_amount=1.23','total_amount=0.01'))).rejects.toThrow();await expect(p.notification('alipay',new Headers(),body+'&app_id=other')).rejects.toThrow();});
