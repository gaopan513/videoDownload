import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const suites = ['core', 'twitter', 'platforms', 'sites', 'meta', 'download-regressions'];
await build({ entryPoints: suites.map(name => `tests/${name}.test.ts`), bundle: true, platform: 'node', format: 'cjs', outdir: 'dist/tests', outExtension: { '.js': '.cjs' }, external: ['electron'] });
const p = spawn(process.execPath, ['--test', ...suites.map(name => `dist/tests/${name}.test.cjs`), 'tests/task-control.test.mjs', 'tests/search-regressions.test.mjs', 'tests/resolver-regressions.test.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
p.stdout.on('data', b => { output += b; process.stdout.write(b); }); p.stderr.on('data', b => { output += b; process.stderr.write(b); });
p.on('exit', async code => { await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/core-tests.txt', output); process.exit(code ?? 1); });
