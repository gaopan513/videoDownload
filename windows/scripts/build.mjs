import { build } from 'esbuild';
await build({ entryPoints: ['src/main/main.ts', 'src/main/preload.ts', 'src/main/worker.ts'], bundle: true, platform: 'node', target: 'node22', format: 'cjs', outdir: 'dist/main', outExtension: { '.js': '.cjs' }, external: ['electron', '@ghostery/adblocker-electron'], sourcemap: true });
