import { LOCAL_WORKSPACE } from '@agentsale/database';
import { failure, getRepository, requireLocal } from '../../../../lib/local-runtime';
import { access } from '../../../../lib/server-access';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { await access(request,false,'operator'); return Response.json(await (await getRepository()).snapshot(LOCAL_WORKSPACE), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return failure(error); }
}
