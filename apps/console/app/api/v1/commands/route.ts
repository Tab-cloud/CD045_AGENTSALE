import { LOCAL_WORKSPACE } from '@agentsale/database';
import { DomainError } from '@agentsale/domain';
import { failure, getRepository, requireLocal } from '../../../../lib/local-runtime';
import { access } from '../../../../lib/server-access';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    await access(request, true, 'operator');
    const body = await request.text();
    if (Buffer.byteLength(body, 'utf8') > 65536) throw new DomainError('INPUT_TOO_LARGE', '输入内容过长', 413);
    let command: unknown;
    try { command = JSON.parse(body); } catch { throw new DomainError('INVALID_JSON', '无法读取提交内容'); }
    const result = await (await getRepository()).execute(LOCAL_WORKSPACE, command, request.headers.get('idempotency-key') || '');
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
