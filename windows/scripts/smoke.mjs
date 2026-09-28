import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const dirs = (await readdir('.test-data')).filter(n => n.startsWith('core-'));
let media;
for (const dir of dirs) { try { media = await readFile(path.join('.test-data', dir, 'source.mp4')); break; } catch {} }
assert.ok(media, 'Run core tests first');
const server = createServer((req, res) => {
  if (req.url === '/cross-page') { res.setHeader('content-type', 'text/html'); res.end(`<iframe src="http://127.0.0.1:${frameServer.address().port}/protected-frame"></iframe>`); return; }
  if (req.url === '/protected-frame') { res.setHeader('content-type', 'text/html'); res.end('<video src="/protected-media"></video><script>fetch("/stats?video=movie.mp4")</script>'); return; }
  if (req.url === '/stats?video=movie.mp4') { res.setHeader('content-type', 'application/json'); res.end('{}'); return; }
  if (req.url === '/protected-media') { if (req.headers.referer !== `http://127.0.0.1:${frameServer.address().port}/protected-frame`) { res.writeHead(403); res.end(); return; } res.setHeader('content-type', 'video/mp4'); res.end(media); return; }
  if (req.url === '/dynamic') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>动态视频验证</title><video muted></video><script>setTimeout(()=>{document.querySelector("video").src="/media.mp4"},600)</script>'); return; }
  if (req.url === '/master.m3u8') { res.setHeader('content-type', 'application/vnd.apple.mpegurl'); res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=160x90\nvideo.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=320x180\nvideo.m3u8'); return; }
  if (req.url === '/empty') { res.setHeader('content-type', 'text/html'); res.end('<title>空页面</title>'); return; }
  if (req.url === '/page') { res.setHeader('content-type', 'text/html'); res.end('<title>测试影片</title><video src="/media.mp4"></video>'); return; }
  if (req.url === '/media.mp4') { res.setHeader('content-type', 'video/mp4'); res.setHeader('etag', '"smoke"'); const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || ''); if (m) { const start = +m[1], end = Math.min(+m[2], media.length - 1); res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${media.length}`, 'content-length': end - start + 1 }); res.end(media.subarray(start, end + 1)); } else { res.setHeader('content-length', media.length); res.end(media); } return; }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const frameServer = createServer(server.listeners('request')[0]);
await new Promise(r => frameServer.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
const userData = path.resolve('.test-data/smoke-' + Date.now()); const output = path.join(userData, 'downloads'); await mkdir(output, { recursive: true }); await mkdir('artifacts', { recursive: true });
const env = { ...process.env, STREAMHARBOR_TEST_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
let app; const checks = [];
try {
  const launch = process.env.STREAMHARBOR_EXE ? { executablePath: process.env.STREAMHARBOR_EXE, args: [] } : { args: ['.'] };
  app = await electron.launch({ ...launch, env }); app.process().stderr.on('data', b => process.stderr.write(b)); const page = await app.firstWindow();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('heading', { name: '下载工作台' }).waitFor();
  const init = await page.evaluate(() => window.harbor.init()); assert.equal(init.tools, ''); checks.push('media tools detected');
  await page.evaluate(s => window.harbor.saveSettings(s), { ...init.settings, directory: output, deep: true });
  await page.reload(); await page.locator('#urls').fill(url + '/page'); await page.getByRole('button', { name: /解析链接/ }).click();
  await page.getByRole('heading', { name: '发现 1 个资源' }).waitFor({ timeout: 15000 }); checks.push('static discovery UI');
  await page.getByRole('button', { name: /下载所选/ }).click();
  await page.getByText('下载完成', { exact: true }).waitFor({ timeout: 20000 }); checks.push('utility-process download, merge and deep verification');
  const dynamic = await page.evaluate(u => window.harbor.resolve(u), url + '/dynamic'); assert.ok(dynamic.length); checks.push('hidden Chromium dynamic discovery');
  const cross = await page.evaluate(u => window.harbor.resolve(u), url + '/cross-page'); assert.equal(cross.length, 1); assert.equal(cross[0].kind, 'mp4'); checks.push('cross-origin iframe Referer, extensionless media and telemetry exclusion');
  const variants = await page.evaluate(u => window.harbor.resolve(u), url + '/master.m3u8'); assert.equal(variants.length, 2); checks.push('master playlist variants');
  const before = Date.now(); const cancelled = page.evaluate(u => window.harbor.resolve(u).then(() => false, () => true), url + '/empty'); await new Promise(r => setTimeout(r, 800)); await page.evaluate(() => window.harbor.cancelResolve()); assert.ok(await cancelled); assert.ok(Date.now() - before < 7000); checks.push('discovery cancellation');
  await page.screenshot({ path: 'artifacts/desktop.png', fullPage: true }); assert.deepEqual(errors, []); checks.push('UI no runtime errors');
  await app.close(); app = undefined;
  const state = await readFile(path.join(userData, 'state.json'), 'utf8'); assert.ok(!state.includes('/media.mp4')); checks.push('credentials not written in plaintext');
  const seeded = JSON.parse(state);
  seeded.tasks.push({ ...seeded.tasks[0], id: 'preserved-paused', state: 'paused', output: undefined });
  await writeFile(path.join(userData, 'state.json'), JSON.stringify(seeded));
  app = await electron.launch({ ...launch, env }); const second = await app.firstWindow(); const restored = await second.evaluate(() => window.harbor.init()); assert.equal(restored.tasks[0].state, 'complete'); checks.push('completed task restored after restart');
  const completedFile = await readFile(restored.tasks[0].output);
  await second.getByRole('button', { name: '清除完成记录', exact: true }).click();
  await second.getByRole('status').filter({ hasText: '已清除 1 条完成记录' }).waitFor();
  const cleared = await second.evaluate(() => window.harbor.init());
  assert.deepEqual(cleared.tasks.map(t => t.id), ['preserved-paused']);
  assert.ok((await readFile(restored.tasks[0].output)).equals(completedFile));
  assert.ok(await second.getByRole('button', { name: '清除完成记录', exact: true }).isDisabled());
  assert.equal(await second.evaluate(() => window.harbor.clearCompleted()), 0);
  checks.push('clear completed records preserves files and unfinished tasks; empty clear is safe');
  await app.close(); app = undefined;
  app = await electron.launch({ ...launch, env }); const third = await app.firstWindow();
  const afterRestart = await third.evaluate(() => window.harbor.init());
  assert.deepEqual(afterRestart.tasks.map(t => t.id), ['preserved-paused']);
  checks.push('cleared completed records stay removed after restart');
  await writeFile('artifacts/smoke-results.json', JSON.stringify({ passed: checks }, null, 2)); console.log(checks.join('\n'));
} finally { await app?.close(); server.closeAllConnections(); server.close(); frameServer.closeAllConnections(); frameServer.close(); }


