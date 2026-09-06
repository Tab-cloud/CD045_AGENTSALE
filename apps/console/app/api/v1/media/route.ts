import { z } from 'zod';
import { failure,getAutomation } from '../../../../lib/local-runtime';
import { access,jsonBody } from '../../../../lib/server-access';
export const runtime='nodejs';export const dynamic='force-dynamic';
const payload=z.object({productId:z.string().uuid(),name:z.string().max(150),rights:z.string().min(1).max(500),base64:z.string().max(14000000)}).strict();
export async function POST(request:Request){try{await access(request,true);const body=payload.parse(await jsonBody(request,14500000));return Response.json({asset:await (await getAutomation()).upload(body.productId,body.name,body.rights,Buffer.from(body.base64,'base64')),message:'素材与权利说明已保存'});}catch(e){if(e instanceof z.ZodError)return Response.json({message:'图片参数无效，文件需小于 10 MB'},{status:400});return failure(e);}}
