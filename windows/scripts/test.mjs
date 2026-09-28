import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
await build({ entryPoints: ['tests/core.test.ts', 'tests/twitter.test.ts', 'tests/platforms.test.ts'], bundle: true, platform: 'node', format: 'cjs', outdir: 'dist/tests', outExtension: { '.js': '.cjs' } });
const p = spawn(process.execPath, ['--test', 'dist/tests/core.test.cjs', 'dist/tests/twitter.test.cjs', 'dist/tests/platforms.test.cjs'], { stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
p.stdout.on('data', b => { output += b; process.stdout.write(b); }); p.stderr.on('data', b => { output += b; process.stderr.write(b); });
p.on('exit', async code => { await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/core-tests.txt', output); process.exit(code ?? 1); });
