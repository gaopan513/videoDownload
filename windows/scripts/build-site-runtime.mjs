import { build } from 'esbuild';
await build({ entryPoints: ['scripts/site-runtime-entry.ts'], bundle: true, platform: 'node', target: 'node22', format: 'cjs', outfile: 'dist/tests/site-runtime.cjs', external: ['electron'] });
