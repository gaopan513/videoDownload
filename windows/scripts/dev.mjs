import { spawn } from 'node:child_process';
import electron from 'electron';
const run = (args) => new Promise((resolve, reject) => { const p = spawn(process.execPath, args, { stdio: 'inherit' }); p.on('exit', c => c ? reject(new Error(`Exit ${c}`)) : resolve()); });
await run(['node_modules/vite/bin/vite.js', 'build']);
await run(['scripts/build.mjs']);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
spawn(electron, ['.'], { stdio: 'inherit', env }).on('exit', c => process.exit(c ?? 0));
