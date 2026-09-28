import {z} from 'zod';
import {failure,getAutomation} from '../../../../lib/local-runtime';
import {access,jsonBody} from '../../../../lib/server-access';
export const runtime='nodejs';export const dynamic='force-dynamic';
const input=z.object({title:z.string().trim().min(1).max(80).optional()}).strict();
export async function GET(request:Request){try{await access(request,false,'operator');return Response.json({conversations:await (await getAutomation()).listConversations()},{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
export async function POST(request:Request){try{await access(request,true,'operator');const body=input.parse(await jsonBody(request,5_000));return Response.json(await (await getAutomation()).createConversation(body.title),{status:201,headers:{'Cache-Control':'no-store'}});}catch(error){if(error instanceof z.ZodError)return Response.json({message:'对话名称需要是 1–80 个字符'},{status:400});return failure(error);}}
