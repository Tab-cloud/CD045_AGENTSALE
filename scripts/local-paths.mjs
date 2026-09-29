import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

export function dataDirectory(root) {
  if (process.env.AGENTSALE_DATA_DIR) return path.resolve(process.env.AGENTSALE_DATA_DIR);
  // PostgreSQL's filesystem operations require NTFS on this Windows host.
  if (process.platform === 'win32') {
    const workspace = `${path.basename(root)}-${createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 8)}`;
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'AgentSale', workspace, 'pglite');
  }
  return path.join(root, '.local/pglite');
}
