import {platform,session} from '../../../../lib/platform';
import {failure,getAutomation} from '../../../../lib/local-runtime';
import {creativeService} from '../../../../lib/creative-service';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request){
  try{
    const actor=await session(request,false,true);
    const {members,payments}=await platform();
    const summary=await members.dashboard(actor);
    const [modelResult,creativeResult,paymentResult]=await Promise.allSettled([
      getAutomation().then(engine=>engine.vault.get()),
      creativeService().then(service=>service.configuration()),payments.configuration()
    ]);
    const settings=modelResult.status==='fulfilled'?modelResult.value:null;
    const creative=creativeResult.status==='fulfilled'?creativeResult.value:null;
    const payment=paymentResult.status==='fulfilled'?paymentResult.value:null;
    return Response.json({...summary,services:{
      model:settings?settings.verifiedAt?'已验证':settings.apiKey||settings.localModel?'待验证':'未配置':'状态暂不可用',
      search:'公开搜索可用',
      image:creative?.image.enabled&&creative.hasImageKey||false,video:creative?.video.enabled&&creative.hasVideoKey||false,
      wechat:payment?.wechat.enabled||false,alipay:payment?.alipay.enabled||false,
      creativeAvailable:!!creative,paymentAvailable:!!payment
    }},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return failure(error);}
}
