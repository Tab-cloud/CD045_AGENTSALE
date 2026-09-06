import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { dataDirectory } from './local-paths.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const app = path.join(root, 'apps/console');
const require = createRequire(path.join(app, 'package.json'));
const mode = ['start', 'build'].includes(process.argv[2]) ? process.argv[2] : 'dev';
const port=process.env.AGENTSALE_PORT||'3045';
if(!/^\d{4,5}$/.test(port)||Number(port)>65535)throw new Error('Invalid local port');
const compatibility = pathToFileURL(path.join(root, 'scripts/windows-readlink.mjs')).href;
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), mode, ...(mode === 'build' ? [] : ['--hostname', '127.0.0.1', '--port', port]), ...(mode !== 'start' ? ['--webpack'] : [])], {
  cwd: app, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${compatibility}`.trim(), NEXT_TELEMETRY_DISABLED: '1', AGENTSALE_LOCAL_DEMO: '1', AGENTSALE_DATA_DIR: dataDirectory(root) }
});
child.on('exit', code => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
