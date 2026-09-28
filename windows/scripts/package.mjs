import { spawn } from 'node:child_process';
const run = args => new Promise((resolve, reject) => { const p = spawn(process.execPath, args, { stdio: 'inherit', env: process.env }); p.on('exit', c => c === 0 ? resolve() : reject(new Error(`Build command exited ${c}`))); });
await run(['node_modules/vue-tsc/bin/vue-tsc.js', '--noEmit']);
await run(['node_modules/vite/bin/vite.js', 'build']);
await run(['scripts/build.mjs']);
await run(['scripts/prepare-media.mjs']);
await run(['node_modules/electron-builder/cli.js', '--win', 'nsis', 'portable', '--x64']);
