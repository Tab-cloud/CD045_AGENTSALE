import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({ resolve: { alias: Object.fromEntries(['contracts','domain','database','automation'].map(name=>['@agentsale/'+name,fileURLToPath(new URL('./packages/'+name+'/src/index.ts',import.meta.url))])) }, test: { include: ['tests/**/*.test.ts'], testTimeout: 30000, hookTimeout: 30000, fileParallelism: false } });
