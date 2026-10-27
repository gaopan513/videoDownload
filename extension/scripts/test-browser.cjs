const { chromium } = require('../../windows/node_modules/playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');

(async () => {
  const root = path.resolve(__dirname, '..');
  const temp = await fs.mkdtemp(path.join(root, '.browser-test-'));
  const bytes = Buffer.alloc(256 * 1024, 42);
  bytes.writeUInt32BE(24, 0); bytes.write('ftypisom', 4);
  const webmBytes = Buffer.from(bytes); webmBytes.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  const changedBytes = Buffer.from(bytes); changedBytes.fill(99, 1024);
  const requests = [];
  let base;
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, referer: req.headers.referer, range: req.headers.range, ifRange: req.headers['if-range'] });
    if (req.url === '/favicon.ico') { res.statusCode = 404; res.end(); }
    else if (req.url === '/other') { res.setHeader('Content-Type', 'text/html'); res.end('<title>其他页面</title><p>没有视频</p>'); }
    else if (req.url === '/page') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<title>下载回归</title><video src="/media.mp4"></video><script>fetch("/media.mp4");fetch("/html.mp4");fetch("/proxy?url=video.mp4")</script>');
    } else if (req.url.startsWith('/html') || req.url.startsWith('/proxy') || req.headers.referer !== base + '/page') {
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html>Forbidden</html>');
    } else {
      const changed = req.url === '/changed.mp4' && req.headers['if-range'];
      const payload = changed ? changedBytes : req.url === '/media.webm' ? webmBytes : bytes;
      if (req.url !== '/unvalidated.mp4') res.setHeader('ETag', changed ? '"fixture-v2"' : '"fixture-v1"');
      res.setHeader('Content-Type', req.url === '/media.webm' ? 'video/webm' : 'video/mp4');
      const range = changed ? undefined : req.headers.range?.match(/bytes=(\d+)-(\d*)/);
      if (!range && req.url === '/gzip.mp4') {
        const compressed = gzipSync(payload);
        res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Content-Length', compressed.length);
        res.end(compressed); return;
      }
      if (!range && req.url === '/chunked.mp4') {
        res.write(payload.subarray(0, 1000)); res.end(payload.subarray(1000)); return;
      }
      if (!range && req.url === '/partial.mp4') {
        res.statusCode = 206; res.setHeader('Content-Range', `bytes 0-4095/${payload.length}`);
        res.setHeader('Content-Length', 4096); res.end(payload.subarray(0, 4096)); return;
      }
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
      if (range) { res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`); }
      res.setHeader('Content-Length', end - start + 1);
      if (['/cross-tab.mp4', '/control.mp4', '/changed.mp4', '/unvalidated.mp4'].includes(req.url) && !range) {
        let offset = 0;
        const timer = setInterval(() => {
          const end = Math.min(payload.length, offset + 32 * 1024);
          res.write(payload.subarray(offset, end)); offset = end;
          if (offset === payload.length) { clearInterval(timer); res.end(); }
        }, 1000);
        res.on('close', () => clearInterval(timer));
      } else if (req.url === '/slow.mp4' && !range) {
        res.write(bytes.subarray(0, 1024));
        const timer = setTimeout(() => res.end(bytes.subarray(1024)), 2500);
        res.on('close', () => clearTimeout(timer));
      } else if (req.url === '/broken.mp4' && !range) {
        res.write(bytes.subarray(0, 1024)); setTimeout(() => res.destroy(), 100);
      } else res.end(payload.subarray(start, end + 1));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  let context;
  const results = [];
  try {
    context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
      executablePath: process.env.CHROME_TEST_EXE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
      args: [`--disable-extensions-except=${path.join(root, 'dist')}`, `--load-extension=${path.join(root, 'dist')}`, '--disable-features=DisableLoadExtensionCommandLineSwitch'],
      acceptDownloads: true,
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.join(temp, 'downloads') });
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(async () => {
      for (let i = 0; i < 50 && !chrome.webRequest.onBeforeSendHeaders.hasListeners(); i++) await new Promise(resolve => setTimeout(resolve, 100));
    });
    const errors = [];
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/page');
    let popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`); await popup.getByRole('tab', { name: /下载任务/ }).click();
    const send = (type, candidate) => popup.evaluate(({ type, candidate }) => chrome.runtime.sendMessage({ type, candidate }), { type, candidate });
    await worker.evaluate(() => {
      const native = chrome.downloads.download.bind(chrome.downloads);
      chrome.downloads.download = options => native(options);
    });
    let candidates;
    for (let i = 0; i < 30; i++) {
      candidates = await worker.evaluate(async () => (await chrome.storage.session.get('tabCandidates')).tabCandidates);
      if (Object.values(candidates || {}).flat().some(c => c.headers?.Referer)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await new Promise(resolve => setTimeout(resolve, 600)); candidates = await worker.evaluate(async () => (await chrome.storage.session.get('tabCandidates')).tabCandidates); const captured = Object.values(candidates || {}).flat();
    assert.equal(captured.length, 1, JSON.stringify(captured)); assert.equal(captured[0].headers.Referer, base + '/page');
    assert.equal(captured[0].size, bytes.length); assert.deepEqual(errors, []);
    results.push('捕获真实 Referer、DOM/网络合并、拒绝 HTML 及 query 假媒体、classic content script 执行');
    const candidate = { ...captured[0], id: 'good', url: base + '/media.mp4#token=abc' };
    const started = await send('START_NATIVE_DOWNLOAD', candidate);
    assert.notEqual(started.task.stage, 'failed', JSON.stringify({started,requests}));
    let task;
    const waitFor = async (id, state) => {
      for (let i = 0; i < 100; i++) {
        const response = await send('GET_NATIVE_DOWNLOADS'); task = response.tasks[id];
        if (task?.stage === state) return task;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Expected ${state}: ${JSON.stringify(task)}`);
    };
    await waitFor('good', 'completed');
    const item = await worker.evaluate(async id => (await chrome.downloads.search({ id }))[0], task.downloadId);
    assert.equal(path.extname(item.filename), '.mp4');
    assert.deepEqual(await fs.readFile(item.filename), bytes);
    assert(requests.filter(r => r.url === '/media.mp4').every(r => r.referer === base + '/page'));
    assert.equal((await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).length, 0);
    results.push('Referer 防盗链通过、hash 去除、原生完整下载字节一致、完成后清理规则');
    await send('START_NATIVE_DOWNLOAD', { ...candidate, id: 'webm', kind: 'webm', url: base + '/media.webm' });
    const webmTask = await waitFor('webm', 'completed');
    const webmItem = await worker.evaluate(async id => (await chrome.downloads.search({ id }))[0], webmTask.downloadId);
    assert.equal(path.extname(webmItem.filename), '.webm'); assert.deepEqual(await fs.readFile(webmItem.filename), webmBytes);
    results.push('WebM 文件头验证、扩展名及保存字节一致');
    for (const route of ['gzip', 'chunked']) {
      await send('START_NATIVE_DOWNLOAD', { ...candidate, id: route, url: base + `/${route}.mp4`, size: bytes.length * 5 });
      const downloaded = await waitFor(route, 'completed');
      const saved = await worker.evaluate(async id => (await chrome.downloads.search({ id }))[0], downloaded.downloadId);
      assert.deepEqual(await fs.readFile(saved.filename), bytes);
      assert.equal(downloaded.diagnostics.expectedBytes, 0);
      assert.equal(downloaded.diagnostics.receivedBytes, bytes.length);
    }
    results.push('gzip 编码长度不同及 chunked 无长度头/陈旧捕获大小不再误判，保存完整字节一致');
    await send('START_NATIVE_DOWNLOAD', { ...candidate, id: 'partial', url: base + '/partial.mp4' });
    const partial = await waitFor('partial', 'failed');
    assert.match(partial.errorMessage, /部分视频/); assert.equal(partial.downloadId, undefined);
    results.push('不完整 206 仍失败，禁止保存部分文件');
    const html = await send('START_NATIVE_DOWNLOAD', { ...candidate, id: 'html', url: base + '/html.mp4' });
    assert.equal(html.task.stage, 'failed'); assert.match(html.task.errorMessage, /网页/); assert.equal(html.task.downloadId, undefined);
    const noReferer = await send('START_NATIVE_DOWNLOAD', { ...candidate, id: 'missing-context', sourceUrl: base + '/media.mp4', headers: {}, url: base + '/media.mp4' });
    assert.equal(noReferer.task.stage, 'failed');
    results.push('HTML 响应及缺少播放上下文在弹出保存前失败');
    const slow = await send('START_NATIVE_DOWNLOAD', { ...candidate, id: 'slow', url: base + '/slow.mp4' });
    assert.equal(slow.task.stage, 'downloading'); assert(slow.task.percentage < 100);
    await popup.close();
    await new Promise(resolve => setTimeout(resolve, 3000));
    const reopened = await context.newPage(); popup = reopened; await reopened.goto(`chrome-extension://${extensionId}/src/popup/index.html`); await reopened.getByRole('tab', { name: /下载任务/ }).click();
    const state = await reopened.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_NATIVE_DOWNLOADS' }));
    assert.equal(state.tasks.slow.stage, 'completed');
    results.push('下载进行中不会假报 100%、popup 关闭仍继续、重开恢复状态');
    await reopened.evaluate(candidate => chrome.runtime.sendMessage({ type: 'START_NATIVE_DOWNLOAD', candidate }), { ...candidate, id: 'interrupted', url: base + '/broken.mp4' });
    await waitFor('interrupted', 'failed');
    const stopped = await reopened.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_NATIVE_DOWNLOADS' }));
    assert.equal(stopped.tasks.interrupted.stage, 'failed');
    results.push('网络中断传播失败，不报告下载完成');
    await send('START_NATIVE_DOWNLOAD', { ...candidate, id: 'cross-tab', title: '跨页面下载视频', url: base + '/cross-tab.mp4' });
    const taskCard = () => popup.locator('section[aria-label="下载任务"] [data-task-id="cross-tab"]');
    await taskCard().waitFor();
    assert.match(await taskCard().innerText(), /跨页面下载视频/);
    const otherPage = await context.newPage(); await otherPage.goto(base + '/other');
    await popup.close();
    popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`); await popup.getByRole('tab', { name: /下载任务/ }).click();
    await taskCard().waitFor();
    await popup.getByRole('tab', { name: /当前页面捕获/ }).click();
    assert.match(await popup.locator('.content-body').innerText(), /当前页面捕获 \(0\)/);
    await popup.getByRole('tab', { name: /下载任务/ }).click();
    await popup.waitForFunction(() => {
      const text = document.querySelector('[data-task-id="cross-tab"] .progress-info')?.textContent || '';
      return /下载中/.test(text) && !/\(0%\)/.test(text);
    });
    const progressing = (await send('GET_NATIVE_DOWNLOADS')).tasks['cross-tab'];
    assert(progressing.percentage > 0 && progressing.percentage < 100);
    await page.goto(base + '/other'); // Navigate away from the original playback page.
    await page.close();
    assert.match(await taskCard().innerText(), /跨页面下载视频/);
    await waitFor('cross-tab', 'completed');
    await popup.waitForFunction(() => document.querySelector('[data-task-id="cross-tab"]')?.textContent?.includes('已保存到本地'));
    assert.match(await taskCard().innerText(), /完成 \(100%\)/);
    const retained = (await send('GET_NATIVE_DOWNLOADS')).tasks['cross-tab'];
    assert.equal(retained.candidate.title, '跨页面下载视频');
    assert.equal(retained.candidate.url, base + '/cross-tab.mp4');
    results.push('跨标签页重开显示全局任务并更新进度、原页面导航/关闭后保留标题及完成状态');
    const controlledCandidate = { ...candidate, id: 'controlled', title: '可控制任务', url: base + '/control.mp4' };
    await send('START_NATIVE_DOWNLOAD', controlledCandidate);
    const controlledCard = () => popup.locator('[data-task-id="controlled"]');
    await popup.waitForFunction(() => {
      const text = document.querySelector('[data-task-id="controlled"] .progress-info')?.textContent || '';
      return /下载中/.test(text) && !/\(0%\)/.test(text);
    });
    await controlledCard().getByRole('button', { name: '暂停', exact: true }).click();
    const paused = await waitFor('controlled', 'paused');
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal((await send('GET_NATIVE_DOWNLOADS')).tasks.controlled.percentage, paused.percentage);
    await controlledCard().getByRole('button', { name: '继续', exact: true }).click();
    const resumed = await waitFor('controlled', 'completed');
    assert(requests.some(r => r.url === '/control.mp4' && /^bytes=[1-9]\d*-/.test(r.range || '') && r.ifRange === '"fixture-v1"'));
    const resumedItem = await worker.evaluate(async id => (await chrome.downloads.search({ id }))[0], resumed.downloadId);
    assert.deepEqual(await fs.readFile(resumedItem.filename), bytes);
    await controlledCard().getByRole('button', { name: '打开文件', exact: true }).waitFor();
    await controlledCard().getByRole('button', { name: '显示文件夹', exact: true }).waitFor();
    await controlledCard().getByRole('button', { name: '移除记录', exact: true }).click();
    assert.equal((await send('GET_NATIVE_DOWNLOADS')).tasks.controlled, undefined);
    assert.equal((await fs.stat(resumedItem.filename)).size, bytes.length);
    results.push('实际点击暂停/继续，进度停止、If-Range 接续及保存字节一致；完成按钮可见、移除记录保留文件');
    await send('START_NATIVE_DOWNLOAD', { ...controlledCandidate, id: 'cancelled' });
    const cancelledCard = () => popup.locator('[data-task-id="cancelled"]');
    await cancelledCard().getByRole('button', { name: '取消下载', exact: true }).click();
    const cancelled = await waitFor('cancelled', 'cancelled');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal((await send('GET_NATIVE_DOWNLOADS')).tasks.cancelled.stage, 'cancelled');
    assert.equal(cancelled.downloadId, undefined);
    await cancelledCard().getByRole('button', { name: '重试', exact: true }).click();
    await waitFor('cancelled', 'completed');
    assert.equal((await send('GET_NATIVE_DOWNLOADS')).tasks.cancelled.stage, 'completed');
    results.push('实际点击取消后停止任务，重试重新创建下载且旧回调不会覆盖新状态');
    await popup.locator('[data-task-id="interrupted"]').getByRole('button', { name: '重试', exact: true }).click();
    await waitFor('interrupted', 'failed');
    assert.equal((await send('GET_NATIVE_DOWNLOADS')).tasks.interrupted.stage, 'failed');
    results.push('网络失败任务提供重试并传播再次失败状态');
    for (const route of ['changed', 'unvalidated']) {
      await send('START_NATIVE_DOWNLOAD', { ...candidate, id: route, url: base + `/${route}.mp4` });
      const card = popup.locator(`[data-task-id="${route}"]`);
      await popup.waitForFunction(id => {
        const text = document.querySelector(`[data-task-id="${id}"] .progress-info`)?.textContent || '';
        return /下载中/.test(text) && !/\(0%\)/.test(text);
      }, route);
      await card.getByRole('button', { name: '暂停', exact: true }).click(); await waitFor(route, 'paused');
      await card.getByRole('button', { name: '继续', exact: true }).click(); const result = await waitFor(route, 'completed');
      const item = await worker.evaluate(async id => (await chrome.downloads.search({ id }))[0], result.downloadId);
      assert.deepEqual(await fs.readFile(item.filename), route === 'changed' ? changedBytes : bytes);
      assert.match(result.notice, /从头|重新下载/);
      if (route === 'unvalidated') assert(!requests.some(r => r.url === '/unvalidated.mp4' && /^bytes=[1-9]\d*-/.test(r.range || '')));
    }
    results.push('文件身份变化或缺少校验标识时从头下载，禁止新旧内容混拼');
    let liveAcceptance;
    if (process.env.LIVE_VIDEO_URL && process.env.LIVE_SOURCE_URL) {
      const liveCandidate = { id: 'live-site', kind: 'mp4', title: 'LibVio 用户反馈视频', url: process.env.LIVE_VIDEO_URL,
        sourceUrl: process.env.LIVE_SOURCE_URL, headers: { Referer: process.env.LIVE_SOURCE_URL }, size: 934277489 };
      console.log('Starting real LibVio full-file validation');
      const startedLive = await send('START_NATIVE_DOWNLOAD', liveCandidate);
      assert.notEqual(startedLive.task.stage, 'failed', JSON.stringify(startedLive));
      await popup.waitForFunction(() => {
        const text = document.querySelector('[data-task-id="live-site"] .progress-info')?.textContent || '';
        return /下载中/.test(text) && !/\(0%\)/.test(text);
      });
      const liveCard = popup.locator('[data-task-id="live-site"]');
      await liveCard.getByRole('button', { name: '暂停', exact: true }).click();
      const pausedLive = await waitFor('live-site', 'paused');
      await new Promise(resolve => setTimeout(resolve, 1000));
      assert.equal((await send('GET_NATIVE_DOWNLOADS')).tasks['live-site'].percentage, pausedLive.percentage);
      await liveCard.getByRole('button', { name: '继续', exact: true }).click();
      console.log('Real LibVio task paused and resumed');
      let liveTask;
      for (let i = 0; i < 6000; i++) {
        liveTask = (await send('GET_NATIVE_DOWNLOADS')).tasks['live-site'];
        if (i % 100 === 0) console.log(JSON.stringify({ liveStage: liveTask.stage, percentage: liveTask.percentage, error: liveTask.errorMessage }));
        if (['completed', 'failed'].includes(liveTask.stage)) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(liveTask.stage, 'completed', JSON.stringify(liveTask));
      const liveItem = await worker.evaluate(async id => (await chrome.downloads.search({ id }))[0], liveTask.downloadId);
      assert.equal((await fs.stat(liveItem.filename)).size, liveTask.diagnostics.expectedBytes);
      const ffprobe = path.resolve(root, '../windows/node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
      const media = JSON.parse(require('node:child_process').execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height', '-of', 'json', liveItem.filename], { encoding: 'utf8' }));
      assert(media.streams.some(s => s.codec_type === 'video'));
      liveAcceptance = { ...liveTask.diagnostics, savedBytes: (await fs.stat(liveItem.filename)).size, media };
      results.push('用户 LibVio 指定视频实际暂停/继续及全文件下载、落盘长度和 FFprobe 验证通过');
    }
    await fs.writeFile(path.join(root, process.env.LIVE_VIDEO_URL ? 'browser-validation.json' : 'browser-controls-validation.json'), JSON.stringify({ at: new Date().toISOString(), browser: await context.browser().version(), results, liveAcceptance,
      siteAcceptance: liveAcceptance ? '用户指定视频完整落盘及 FFprobe 验证，未做整片解码，未验证用户原 Chrome 会话' : '未验证用户真实 LibVio 整集下载；受控 MP4 字节夹具不作为媒体解码验证' }, null, 2));
    console.log(JSON.stringify({ passed: results.length, results }, null, 2));
  } finally {
    if (context) await context.close();
    await new Promise(resolve => server.close(resolve));
    // This directory is created by this run inside extension, never a user's profile.
    assert(temp.startsWith(root + path.sep + '.browser-test-'));
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
