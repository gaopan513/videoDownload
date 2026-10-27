import { _electron as electron } from 'playwright';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = path.join(root, '.test-data');
await mkdir(testRoot, { recursive: true });
const temporary = await mkdtemp(path.join(testRoot, 'resolver-desktop-'));
const bundle = path.join(temporary, 'main.cjs');
const requests = [];
const server = createServer((req, res) => {
  requests.push(req.url);
  if (req.url?.endsWith('.mp4')) {
    if (!req.headers.cookie?.includes('site-access=ready')) { res.writeHead(403); res.end(); return; }
    res.setHeader('content-type', 'video/mp4'); res.end('local media response'); return;
  }
  res.setHeader('content-type', 'text/html');
  const name = req.url === '/A' ? 'A' : req.url === '/C' ? 'C' : undefined;
  res.end(`<title>${name || 'Other site window'}</title>${name ? `<script>setTimeout(() => fetch('/${name}.mp4'), ${name === 'A' ? 1200 : 100})</script>` : ''}`);
});
let app;
try {
  await build({
    stdin: { contents: `import { app, BrowserWindow } from 'electron';
      import { discover } from './src/main/resolver';
      app.setPath('userData', process.env.STREAMHARBOR_TEST_DATA);
      globalThis.discoverForTest = discover;
      app.whenReady().then(() => { const keeper = new BrowserWindow({ show: false }); void keeper.loadURL('about:blank'); });`,
    resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], outfile: bundle
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, STREAMHARBOR_TEST_DATA: path.join(temporary, 'user-data') }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [bundle], env });
  const result = await app.evaluate(async ({ app, BrowserWindow, session }, base) => {
    await app.whenReady();
    const ses = session.fromPartition('persist:resolver-regression');
    await ses.cookies.set({ url: base, name: 'site-access', value: 'ready' });
    const other = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, nodeIntegration: false, contextIsolation: true } });
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]);
    try {
      await other.loadURL(base + '/B');
      const first = globalThis.discoverForTest(base + '/A', '', signal, ses);
      void first.catch(() => {});
      for (let n = 0; n < 100 && !BrowserWindow.getAllWindows().some(window => window.webContents.getURL() === base + '/A'); n++) await new Promise(resolve => setTimeout(resolve, 20));
      if (!BrowserWindow.getAllWindows().some(window => window.webContents.getURL() === base + '/A')) throw new Error('First resolver did not navigate');
      const second = globalThis.discoverForTest(base + '/C', '', signal, ses);
      void second.catch(() => {});
      await other.webContents.executeJavaScript("fetch('/B.mp4').then(response => response.text())");
      await new Promise(resolve => setTimeout(resolve, 300));
      const queued = !BrowserWindow.getAllWindows().some(window => window.webContents.getURL() === base + '/C');
      const a = await first, c = await second;
      return { queued, a: a.map(candidate => candidate.url), c: c.map(candidate => candidate.url), loginRetained: (await ses.cookies.get({ url: base })).some(cookie => cookie.name === 'site-access' && cookie.value === 'ready'), allHidden: BrowserWindow.getAllWindows().every(window => !window.isVisible()) };
    } finally { abort.abort(); other.destroy(); }
  }, base);
  assert.equal(result.queued, true, 'Second resolver must wait for the same login session');
  assert.deepEqual(result.a, [base + '/A.mp4']);
  assert.deepEqual(result.c, [base + '/C.mp4']);
  assert.equal(result.loginRetained, true);
  assert.equal(result.allHidden, true);
  for (const endpoint of ['/A', '/B.mp4', '/C', '/A.mp4', '/C.mp4']) assert.ok(requests.includes(endpoint), `Fixture must exercise ${endpoint}`);
  console.log('PASS: real Electron isolates shared-session windows, queues concurrent discovery, retains login cookies; all windows hidden.');
} finally {
  if (app) await app.close();
  await new Promise(resolve => server.close(resolve));
  // Only the unique directory created by this invocation is eligible for cleanup.
  assert.equal(path.dirname(temporary), testRoot);
  assert.ok(path.basename(temporary).startsWith('resolver-desktop-'));
  await rm(temporary, { recursive: true, force: true });
}
