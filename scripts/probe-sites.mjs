import { build } from 'esbuild';
import { spawn } from 'node:child_process';
await build({ entryPoints: ['src/main/resolver.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: 'dist/tests/resolver.cjs', external: ['electron'] });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn('node_modules/electron/dist/electron.exe', ['scripts/resolve-probe.cjs'], { env, stdio: 'inherit' });
child.on('error', e => { console.error(e); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
