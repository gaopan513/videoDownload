import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const dirs = (await readdir('.test-data')).filter(n => n.startsWith('core-'));
let media;
for (const dir of dirs) { try { media = await readFile(path.join('.test-data', dir, 'source.mp4')); break; } catch {} }
assert.ok(media, 'Run core tests first');
let adRulesRequests = 0;
let adRulesFail = false;
const server = createServer((req, res) => {
  if (req.url === '/ad-rules') { adRulesRequests++; if (adRulesFail) { res.writeHead(503); res.end('unavailable'); } else { res.setHeader('content-type', 'text/plain'); res.end('[Adblock Plus 2.0]\n||127.0.0.1^$script\n##.ad-banner\n'); } return; }
  if (req.url === '/ad-test') { res.setHeader('content-type', 'text/html'); res.end('<div class="ad-banner">advertisement</div><script src="/ad-script.js"></script><div id="content">page content</div>'); return; }
  if (req.url === '/ad-script.js') { res.setHeader('content-type', 'application/javascript'); res.end('window.adScriptExecuted = true'); return; }
  if (req.url === '/') { res.setHeader('set-cookie', 'site-access=ready; Path=/; SameSite=Lax'); res.setHeader('content-type', 'text/html'); res.end('<title>本地站点</title>访问已完成'); return; }
  if (req.url?.startsWith('/search.php')) { if (!req.headers.cookie?.includes('site-access=ready')) { res.writeHead(403); res.end('login required'); return; } res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<script>window.SOTV_SEARCH_PROGRESS = {"items":[{"_api_id":"1","vod_id":"7","vod_name":"站点测试片","vod_year":"2026","_api_name":"本地源"}],"perPage":16};</script>`); return; }
  if (req.url?.startsWith('/detail.php')) { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<button class="play-source-tab" data-src="0">本地线路</button><div data-src-panel="0"><a class="play-ep-pill" href="/play.php?ep=0">第1集</a><a class="play-ep-pill" href="/play.php?ep=1">第2集</a></div>`); return; }
  if (req.url?.startsWith('/play.php')) { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(req.url.includes('ep=1') ? '<title>播放测试</title><video src="/master.m3u8"></video>' : `<title>播放测试</title><iframe src="http://127.0.0.1:${frameServer.address().port}/protected-frame"></iframe>`); return; }
  if (req.url === '/cross-page') { res.setHeader('content-type', 'text/html'); res.end(`<iframe src="http://127.0.0.1:${frameServer.address().port}/protected-frame"></iframe>`); return; }
  if (req.url === '/protected-frame') { res.setHeader('content-type', 'text/html'); res.end('<video src="/protected-media"></video><script>fetch("/stats?video=movie.mp4")</script>'); return; }
  if (req.url === '/stats?video=movie.mp4') { res.setHeader('content-type', 'application/json'); res.end('{}'); return; }
  if (req.url === '/protected-media') { if (req.headers.referer !== `http://127.0.0.1:${frameServer.address().port}/protected-frame`) { res.writeHead(403); res.end(); return; } res.setHeader('content-type', 'video/mp4'); res.end(media); return; }
  if (req.url === '/dynamic') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>动态视频验证</title><video muted></video><script>setTimeout(()=>{document.querySelector("video").src="/media.mp4"},600)</script>'); return; }
  if (req.url === '/master.m3u8') { res.setHeader('content-type', 'application/vnd.apple.mpegurl'); res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=160x90\nvideo.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=320x180\nvideo.m3u8'); return; }
  if (req.url === '/empty') { res.setHeader('content-type', 'text/html'); res.end('<title>空页面</title>'); return; }
  if (req.url === '/page') { res.setHeader('content-type', 'text/html'); res.end('<title>测试影片</title><video src="/media.mp4"></video>'); return; }
  if (req.url === '/media.mp4') { res.setHeader('content-type', 'video/mp4'); res.setHeader('etag', '"smoke"'); const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || ''); if (m) { const start = +m[1], end = Math.min(+m[2], media.length - 1); res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${media.length}`, 'content-length': end - start + 1 }); res.end(media.subarray(start, end + 1)); } else { res.setHeader('content-length', media.length); res.end(media); } return; }
  if (req.url === '/slow-media.mp4') { res.setHeader('content-type', 'video/mp4'); res.setHeader('etag', '"slow-smoke"'); const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || ''); const send = () => { if (res.destroyed) return; if (m) { const start = +m[1], end = Math.min(+m[2], media.length - 1); res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${media.length}`, 'content-length': end - start + 1 }); res.end(media.subarray(start, end + 1)); } else { res.setHeader('content-length', media.length); res.end(media); } }; if (req.headers.range === 'bytes=0-0') send(); else setTimeout(send, 5000); return; }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const frameServer = createServer(server.listeners('request')[0]);
await new Promise(r => frameServer.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
const userData = path.resolve('.test-data/smoke-' + Date.now()); const output = path.join(userData, 'downloads'); await mkdir(output, { recursive: true }); await mkdir('artifacts', { recursive: true });
const env = { ...process.env, STREAMHARBOR_TEST_DATA: userData, STREAMHARBOR_TEST_AD_RULES_URL: url + '/ad-rules' }; delete env.ELECTRON_RUN_AS_NODE;
let app; const checks = [];
try {
  const packagedExe = process.env.STREAMHARBOR_EXE || process.argv[2];
  const launch = packagedExe ? { executablePath: path.resolve(packagedExe), args: [] } : { args: ['.'] };
  app = await electron.launch({ ...launch, env }); app.process().stderr.on('data', b => process.stderr.write(b)); const page = await app.firstWindow();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('heading', { name: '下载工作台' }).waitFor();
  const init = await page.evaluate(() => window.harbor.init()); assert.equal(init.tools, ''); checks.push('media tools detected');
  assert.ok(!(await page.evaluate(() => window.harbor.sites())).some(site => site.id === 'libvio' || site.adapter === 'stui'));
  checks.push('retired LibVio site and Stui adapter absent from default catalog');
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
  assert.match(await readFile(path.join(userData, 'ad-rules.txt'), 'utf8'), /\|\|127\.0\.0\.1\^\$script/);
  assert.ok(adRulesRequests >= 1); checks.push('ad rules fetched and cached on startup');
  const seeded = JSON.parse(state);
  seeded.tasks.push({ ...seeded.tasks[0], id: 'preserved-paused', state: 'paused', output: undefined });
  seeded.tasks.push({ ...seeded.tasks[0], id: 'preserved-failed', state: 'failed', output: undefined });
  seeded.tasks.push({ ...seeded.tasks[0], id: 'preserved-cancelled', state: 'cancelled', output: undefined });
  await writeFile(path.join(userData, 'state.json'), JSON.stringify(seeded));
  app = await electron.launch({ ...launch, env }); const second = await app.firstWindow(); const restored = await second.evaluate(() => window.harbor.init()); assert.equal(restored.tasks[0].state, 'cancelled'); assert.equal(restored.tasks[1].state, 'failed'); const completeTask = restored.tasks.find(t => t.state === 'complete'); assert.ok(completeTask); checks.push('newest task first and terminal task states restored after restart');
  const completedFile = await readFile(completeTask.output);
  await second.getByRole('button', { name: '清除完成记录', exact: true }).click();
  await second.getByRole('status').filter({ hasText: '已清除 1 条完成记录' }).waitFor();
  const cleared = await second.evaluate(() => window.harbor.init());
  assert.deepEqual(cleared.tasks.map(t => t.id), ['preserved-cancelled', 'preserved-failed', 'preserved-paused']);
  assert.ok((await readFile(completeTask.output)).equals(completedFile));
  assert.ok(await second.getByRole('button', { name: '清除完成记录', exact: true }).isDisabled());
  assert.equal(await second.evaluate(() => window.harbor.clearCompleted()), 0);
  checks.push('clear completed records preserves files and unfinished tasks; empty clear is safe');
  await app.close(); app = undefined;
  app = await electron.launch({ ...launch, env }); let third = await app.firstWindow();
  const afterRestart = await third.evaluate(() => window.harbor.init());
  assert.deepEqual(afterRestart.tasks.map(t => t.id), ['preserved-cancelled', 'preserved-failed', 'preserved-paused']);
  checks.push('cleared completed records stay removed after restart');
  await third.getByRole('button', { name: '删除记录' }).first().click();
  await third.waitForFunction(() => window.harbor.init().then(data => !data.tasks.some(t => t.id === 'preserved-cancelled')));
  for (const id of ['preserved-failed', 'preserved-paused']) await third.evaluate(id => window.harbor.deleteRecord(id), id);
  assert.deepEqual((await third.evaluate(() => window.harbor.init())).tasks, []);
  await app.close(); const beforeFailedUpdate = adRulesRequests; adRulesFail = true;
  app = await electron.launch({ ...launch, env }); third = await app.firstWindow();
  assert.deepEqual((await third.evaluate(() => window.harbor.init())).tasks, []);
  checks.push('cancelled, failed and paused records can be deleted durably');
  const site = { id: 'local-site', name: '本地站点', url: url + '/', adapter: 'sotvla', enabled: true };
  await third.evaluate(s => window.harbor.saveSites([s]), site);
  await third.evaluate(() => window.harbor.visitSite('local-site'));
  const visit = app.windows().find(w => w.url() === site.url);
  assert.ok(visit); assert.equal(await visit.evaluate(() => typeof window.harbor), 'undefined');
  await visit.close(); checks.push('manual site visit retains session cookie without app preload');
  const found = await third.evaluate(async () => {
    const requestId = crypto.randomUUID();
    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => { off(); reject(new Error('search timeout')); }, 10000);
      const off = window.harbor.onSearch(value => { if (value.requestId !== requestId) return; clearTimeout(timeout); off(); value.error ? reject(new Error(value.error)) : resolve(value.result); });
      try { await window.harbor.search('站点测试片', ['local-site'], 1, undefined, requestId); } catch (e) { clearTimeout(timeout); off(); reject(e); }
    });
  });
  assert.equal(found.items.length, 1); const detail = await third.evaluate(item => window.harbor.detail(item), found.items[0]);
  assert.deepEqual(detail.lines[0].episodes.map(e => e.name), ['第1集', '第2集']); checks.push('site search and detail through Electron IPC');
  const batchId = 'smoke-batch-1';
  assert.equal(await third.evaluate(([d, out, id]) => window.harbor.batch(d, '0', ['0:0'], out, id), [detail, output, batchId]), 1);
  assert.equal(await third.evaluate(([d, out, id]) => window.harbor.batch(d, '0', ['0:0'], out, id), [detail, output, batchId]), 0);
  await third.getByText('下载完成', { exact: true }).waitFor({ timeout: 30000 }); checks.push('batch episode resolves at slot with nested iframe Referer; duplicate submission is ignored');
  const finishedTask = (await third.evaluate(() => window.harbor.init())).tasks.find(t => t.state === 'complete'); assert.ok(finishedTask?.output);
  const finishedFile = await readFile(finishedTask.output);
  await third.evaluate(id => window.harbor.deleteRecord(id), finishedTask.id);
  assert.ok((await readFile(finishedTask.output)).equals(finishedFile));
  checks.push('completed record deletion preserves the video file');
  assert.equal(await third.evaluate(([d, out]) => window.harbor.batch(d, '0', ['0:1'], out, 'smoke-batch-2'), [detail, output]), 1);
  await third.getByText('选择资源', { exact: true }).waitFor({ timeout: 20000 }); checks.push('multiple media candidates wait for user choice');
  await new Promise(r => setTimeout(r, 600));
  const batchState = await readFile(path.join(userData, 'state.json'), 'utf8');
  assert.ok(!batchState.includes('/play.php') && !batchState.includes('/master.m3u8')); checks.push('episode and media URLs remain encrypted in saved tasks');
  const choiceTask = (await third.evaluate(() => window.harbor.init())).tasks.find(t => t.state === 'choice'); assert.ok(choiceTask);
  await third.evaluate(id => window.harbor.deleteRecord(id), choiceTask.id);
  assert.ok(!(await third.evaluate(() => window.harbor.init())).tasks.some(t => t.id === choiceTask.id));
  const slow = await third.evaluate(async ([source, directory]) => { const candidate = (await window.harbor.resolve(source))[0]; await window.harbor.add(candidate.id, directory); return (await window.harbor.init()).tasks[0].id; }, [url + '/slow-media.mp4', output]);
  await third.waitForFunction(id => window.harbor.init().then(data => data.tasks.some(t => t.id === id && t.state === 'downloading')), slow, { timeout: 10000 });
  await third.evaluate(id => window.harbor.deleteRecord(id), slow);
  assert.ok(!(await third.evaluate(() => window.harbor.init())).tasks.some(t => t.id === slow));
  checks.push('choice and active download records stop and delete cleanly');
  await third.getByRole('button', { name: '搜索发现' }).click();
  await third.getByRole('button', { name: 'Google 搜索' }).waitFor();
  await third.getByRole('button', { name: 'DuckDuckGo 搜索' }).waitFor();
  for (let attempt = 0; adRulesRequests === beforeFailedUpdate && attempt < 50; attempt++) await new Promise(r => setTimeout(r, 100));
  assert.ok(adRulesRequests > beforeFailedUpdate, 'Startup did not retry the ad rule update');
  await third.getByLabel('网页搜索内容').fill('站点测试片');
  assert.match(await third.locator('.web-search').innerText(), /复制当前网址/);
  const originalClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    for (const [engine, button] of [['google', 'Google 搜索'], ['duckduckgo', 'DuckDuckGo 搜索']]) {
      const opened = app.waitForEvent('window');
      await third.getByRole('button', { name: button }).click();
      const searchWindow = await opened;
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2);
      await third.getByText('已加载广告过滤规则。', { exact: false }).waitFor();
      await app.evaluate(({ BrowserWindow }, expected) => { const browser = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith(expected)); if (!browser) throw new Error('Search window missing'); browser.focus(); browser.webContents.focus(); browser.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'L', modifiers: ['control'] }); }, engine === 'google' ? 'https://www.google.com/' : 'https://duckduckgo.com/');
      const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
      assert.ok(copied.startsWith(engine === 'google' ? 'https://www.google.com/search?q=' : 'https://duckduckgo.com/?q='), `Copied URL: ${copied}`);
      await searchWindow.close();
    }
  } finally { await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), originalClipboard); }
  const filterOpened = app.waitForEvent('window');
  await app.evaluate(({ BrowserWindow, session }, testUrl) => { const browser = new BrowserWindow({ show: true, webPreferences: { session: session.fromPartition('persist:web-search'), sandbox: true, contextIsolation: true, nodeIntegration: false } }); void browser.loadURL(testUrl); }, url + '/ad-test');
  const filterWindow = await filterOpened;
  await filterWindow.waitForFunction(() => { const banner = document.querySelector('.ad-banner'); return !!banner && getComputedStyle(banner).display === 'none'; });
  assert.equal(await filterWindow.evaluate(() => window.adScriptExecuted), undefined);
  await filterWindow.close();
  checks.push('both in-app search windows block network ads and hide page ads using cached rules after update failure');
  await third.getByPlaceholder('输入片名').fill('站点测试片');
  await third.getByLabel('本地站点').check();
  await third.getByRole('button', { name: '搜索', exact: true }).click();
  await third.getByRole('button', { name: '查看剧集' }).waitFor({ timeout: 10000 });
  await third.getByRole('button', { name: '查看剧集' }).click();
  try { await third.getByText('第2集').waitFor({ timeout: 5000 }); } catch (e) { await third.screenshot({ path: 'artifacts/search-ui-failure.png', fullPage: true }); console.error((await third.locator('body').innerText()).slice(0, 2500)); throw e; }
  assert.ok(await third.evaluate(() => { const row = document.querySelector('.result-row'); const detail = document.querySelector('.result-entry .discovery-detail'); return !!row && !!detail && row.getBoundingClientRect().bottom <= detail.getBoundingClientRect().top; }));
  await third.getByRole('button', { name: '下载工作台' }).click();
  await third.getByRole('button', { name: '搜索发现' }).click();
  assert.equal(await third.getByRole('button', { name: '收起剧集' }).count(), 1);
  const blockedSite = { id: 'blocked-site', name: '待验证站点', url: `http://127.0.0.1:${frameServer.address().port}/`, adapter: 'sotvla', enabled: true };
  await third.evaluate(([first, second]) => window.harbor.saveSites([first, second]), [site, blockedSite]);
  await third.getByRole('button', { name: '资源站点' }).click();
  await third.getByRole('button', { name: '搜索发现' }).click();
  await third.getByLabel('本地站点').uncheck();
  await third.getByLabel('待验证站点').check();
  await third.getByRole('button', { name: '搜索', exact: true }).click();
  const blocked = third.locator('.site-results').filter({ has: third.getByRole('heading', { name: '待验证站点' }) });
  await blocked.getByRole('button', { name: '完成并重试' }).waitFor();
  assert.equal(await third.locator('.site-results h2').first().innerText(), '待验证站点');
  await blocked.getByRole('button', { name: '完成并重试' }).click();
  await third.getByText(/待验证站点：访问受限/).waitFor();
  await blocked.getByRole('button', { name: '完成并重试' }).waitFor();
  checks.push('selected site sorts first and retry reports progress and failure');
  await third.screenshot({ path: 'artifacts/search-ui.png', fullPage: true }); checks.push('search page and episode selection UI');
  await third.getByRole('button', { name: '资源站点' }).click();
  await third.getByRole('heading', { name: '添加站点' }).waitFor();
  await third.screenshot({ path: 'artifacts/sites-ui.png', fullPage: true }); checks.push('site management UI');
  await writeFile('artifacts/smoke-results.json', JSON.stringify({ passed: checks }, null, 2)); console.log(checks.join('\n'));
} finally { await app?.close(); server.closeAllConnections(); server.close(); frameServer.closeAllConnections(); frameServer.close(); }


