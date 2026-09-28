import {z} from 'zod';
import {failure,getAutomation} from '../../../../lib/local-runtime';
import {access,jsonBody} from '../../../../lib/server-access';
export const runtime='nodejs';export const dynamic='force-dynamic';
const input=z.object({message:z.string().trim().min(1).max(2000),conversationId:z.string().uuid().optional()}).strict();
export async function GET(request:Request){try{await access(request,false,'operator');const conversationId=new URL(request.url).searchParams.get('conversationId')||undefined;return Response.json(await (await getAutomation()).agentSnapshot(conversationId),{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
export async function POST(request:Request){try{const user=await access(request,true,'operator'),body=input.parse(await jsonBody(request,20_000));return Response.json(await (await getAutomation()).agentChat(body.message,user,body.conversationId),{headers:{'Cache-Control':'no-store'}});}catch(error){if(error instanceof z.ZodError)return Response.json({message:'请输入 1–2000 字的目标或命令'},{status:400});return failure(error);}}
