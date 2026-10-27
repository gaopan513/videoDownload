const { chromium } = require('../../windows/node_modules/playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  const temp = await fs.mkdtemp(path.join(root, '.series-test-'));
  const requests = [];
  const result = [];
  const chunks = Array.from({ length: 30 }, (_, index) => { const bytes = Buffer.alloc(188 * 4, index); for (let offset = 0; offset < bytes.length; offset += 188) bytes[offset] = 0x47; return bytes; });
  let base; let context;
  const links = line => Array.from({ length: line === 0 ? 5 : 2 }, (_, index) => `<li><a href="/w/999-${line}-${index}.html">第${index + 1}集</a></li>`).join('');
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, referer: req.headers.referer });
    if (req.url.startsWith('/captured.mp4')) { const clip = Buffer.alloc(128 * 1024, 5); clip.writeUInt32BE(24); clip.write('ftypisom', 4); res.setHeader('Content-Type', 'video/mp4'); res.end(clip); return; }
    if (req.url === '/movie/999.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<h1>批量下载测试</h1><a href="#playlist1">高速</a><a href="#playlist2">备用</a><div id="playlist1"><ul class="myui-content__list">${links(0)}</ul></div><div id="playlist2"><ul class="myui-content__list">${links(1)}</ul></div><a href="/play/123-0-0.html">推荐作品</a>`); return; }
    const play = /^\/w\/999-(\d+)-(\d+)\.html$/.exec(req.url);
    if (play) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<h3>批量下载测试</h3><ul class="myui-content__list playlist">${links(Number(play[1]))}</ul><iframe src="/embed/${play[1]}-${play[2]}"></iframe>`); return; }
    const embed = /^\/embed\/(\d+-\d+)$/.exec(req.url);
    if (embed) { res.setHeader('Content-Type', 'text/html'); const send = () => res.end(`<title>播放器</title><script>var main = ${JSON.stringify(`/media/${embed[1]}/index.m3u8`)};</script>`); const timer = setTimeout(send, 3500); res.on('close', () => clearTimeout(timer)); return; }
    const media = /^\/media\/(\d+-\d+)\/(index\.m3u8|seg(\d+)\.ts)$/.exec(req.url);
    if (media) {
      if (req.headers.referer !== base + '/embed/' + media[1]) { res.statusCode = 403; res.end('Playback Referer required'); return; }
      if (media[2] === 'index.m3u8') { res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); res.end('#EXTM3U\n#EXT-X-TARGETDURATION:1\n' + chunks.map((_, index) => `#EXTINF:1,\nseg${index}.ts\n`).join('') + '#EXT-X-ENDLIST\n'); return; }
      res.setHeader('Content-Type', 'video/mp2t'); const timer = setTimeout(() => res.end(chunks[Number(media[3])]), 700); res.on('close', () => clearTimeout(timer)); return;
    }
    res.setHeader('Content-Type', 'text/html'); res.end('<title>无剧集页面</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    context = await chromium.launchPersistentContext(path.join(temp, 'profile'), { executablePath: process.env.CHROME_TEST_EXE, headless: true,
      args: [`--load-extension=${path.join(root, 'dist')}`, `--disable-extensions-except=${path.join(root, 'dist')}`], acceptDownloads: true });
    let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async () => { for (let i = 0; i < 50 && !chrome.webRequest.onResponseStarted.hasListeners(); i++) await new Promise(r => setTimeout(r, 100)); });
    const extensionId = new URL(worker.url()).host;
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.join(temp, 'downloads') });
    const page = await context.newPage(); await page.goto(base + '/movie/999.html');
    await page.evaluate(() => fetch('/captured.mp4').then(r => r.arrayBuffer()));
    const versions = new Map(); const sw = await context.newCDPSession(page);
    sw.on('ServiceWorker.workerVersionUpdated', event => { for (const version of event.versions) versions.set(version.versionId, version); }); await sw.send('ServiceWorker.enable');
    let rpcId = 0;
    const pending = new Map();
    cdp.on('Target.receivedMessageFromTarget', event => {
      const message = JSON.parse(event.message);
      const callback = pending.get(`${event.sessionId}:${message.id}`);
      if (callback) { pending.delete(`${event.sessionId}:${message.id}`); message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result); }
    });
    const openPopup = async () => {
      const [window] = await worker.evaluate(() => chrome.windows.getAll({ windowTypes: ['normal'] }));
      await worker.evaluate(id => chrome.windows.update(id, { focused: true }), window.id);
      await new Promise(resolve => setTimeout(resolve, 200));
      await worker.evaluate(() => chrome.action.openPopup());
      let target;
      for (let i = 0; i < 30; i++) {
        target = (await cdp.send('Target.getTargets')).targetInfos.find(t => t.url === `chrome-extension://${extensionId}/src/popup/index.html`);
        if (target) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(target, 'chrome.action.openPopup did not create a toolbar popup');
      console.log(JSON.stringify({ toolbarPopupType: target.type }));
      // Toolbar popups are CDP page targets but Playwright does not expose them
      // in context.pages(). Attach to the actual target, never open a substitute tab.
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
      const call = async (method, params = {}) => {
        const id = ++rpcId;
        const result = new Promise((resolve, reject) => pending.set(`${sessionId}:${id}`, { resolve, reject }));
        await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) });
        return result;
      };
      const popup = {
        async evaluate(fn, argument) {
          const evaluated = await call('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(argument) || 'undefined'})`, awaitPromise: true, returnByValue: true, userGesture: true });
          if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.exception?.description || evaluated.exceptionDetails.text);
          return evaluated.result.value;
        },
        async waitForFunction(fn, options = {}) {
          for (let i = 0; i < (options.timeout || 10000) / 100; i++) {
            if (await this.evaluate(fn)) return;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          const diagnostic = await this.evaluate(async () => ({ text: document.body.innerText, tasks: (await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks }));
          throw new Error(`Popup wait failed: ${fn}\n${JSON.stringify(diagnostic)}`);
        },
        async close() { await cdp.send('Target.closeTarget', { targetId: target.targetId }); await new Promise(resolve => setTimeout(resolve, 400)); },
        async clickTaskButton(label) {
          await this.evaluate(label => {
            const button = Array.from(document.querySelectorAll('[data-task-id="lifecycle"] button')).find(button => button.textContent.trim() === label);
            if (!button || button.disabled) throw new Error(`Button not available: ${label}`); button.click();
          }, label);
        },
        async screenshot(options) { const shot = await call('Page.captureScreenshot'); await fs.writeFile(options.path, Buffer.from(shot.data, 'base64')); }
      };
      await popup.waitForFunction(() => Boolean(document.querySelector('section[aria-label="下载任务"]')));
      assert.equal(await popup.evaluate(() => document.querySelector('.version-tag').textContent), `v${JSON.parse(await fs.readFile(path.join(root, 'dist/manifest.json'), 'utf8')).version}`);
      return popup;
    };

    const waitFor = async (predicate, timeout = 25000) => {
      for (let index = 0; index < timeout / 100; index++) { const tasks = await worker.evaluate(async () => Object.values((await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks || {})); if (predicate(tasks)) return tasks; await new Promise(resolve => setTimeout(resolve, 100)); }
      const diagnostic = await worker.evaluate(async () => ({ tasks: (await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks, tabs: (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url, pendingUrl: tab.pendingUrl, status: tab.status })), captured: (await chrome.storage.session.get('tabCandidates')).tabCandidates }));
      throw new Error('Task timeout: ' + JSON.stringify({ ...diagnostic, requests }));
    };
    let rpcDocument;
    const control = (id, action) => (rpcDocument || popup).evaluate(({ id, action }) => chrome.runtime.sendMessage({ type: 'CONTROL_NATIVE_DOWNLOAD', taskId: id, action }), { id, action });
    const badge = () => worker.evaluate(async url => { const tab = (await chrome.tabs.query({})).find(tab => tab.url === url); return chrome.action.getBadgeText({ tabId: tab.id }); }, base + '/movie/999.html');
    let popup;
    if (!process.env.LIVE_ONLY) {
    for (let i = 0; i < 30 && await badge() !== '1'; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(await badge(), '1', JSON.stringify(await worker.evaluate(async () => ({ captured: (await chrome.storage.session.get('tabCandidates')).tabCandidates, tabs: await chrome.tabs.query({}) }))));
    const otherPage = await context.newPage(); await otherPage.goto(base + '/empty');
    const otherId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, base + '/empty');
    assert.equal(await worker.evaluate(id => chrome.action.getBadgeText({ tabId: id }), otherId), '');
    await otherPage.evaluate(() => Promise.all([fetch('/captured.mp4?one').then(r => r.arrayBuffer()), fetch('/captured.mp4?two').then(r => r.arrayBuffer())]));
    for (let i = 0; i < 30 && await worker.evaluate(id => chrome.action.getBadgeText({ tabId: id }), otherId) !== '2'; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(await worker.evaluate(id => chrome.action.getBadgeText({ tabId: id }), otherId), '2'); assert.equal(await badge(), '1');
    await otherPage.reload();
    for (let i = 0; i < 30 && await worker.evaluate(id => chrome.action.getBadgeText({ tabId: id }), otherId) !== ''; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(await worker.evaluate(id => chrome.action.getBadgeText({ tabId: id }), otherId), '');
    await otherPage.close(); await page.bringToFront();
    result.push('每标签页角标分别为1/2，无资源页为空；刷新页面重置本页捕获数');
    popup = await openPopup();
    await popup.waitForFunction(() => document.querySelector('#tab-captures').getAttribute('aria-selected') === 'true' && document.querySelector('#panel-captures').style.display !== 'none');
    assert.equal(await popup.evaluate(() => document.querySelector('#panel-downloads').style.display), 'none');
    assert.equal(await popup.evaluate(() => document.querySelector('#panel-series').style.display), 'none');
    assert.equal(await popup.evaluate(() => Boolean(document.querySelector('[title="清空本页列表"]'))), false);
    await popup.waitForFunction(() => document.querySelector('#panel-captures').textContent.includes('/captured.mp4'));
    await popup.screenshot({ path: path.join(root, 'ui-captures-preview.png') });
    await popup.evaluate(() => document.querySelector('#tab-series').click());
    await popup.waitForFunction(() => document.querySelector('#panel-series').style.display !== 'none');
    assert.equal(await badge(), '1');
    result.push('真实工具栏默认当前捕获，三个页面切换独立显示；删除本页清空按钮并保留捕获资源');
    const fillRange = async (first, last) => {
      await popup.evaluate(({first, last}) => {
        const fields = document.querySelectorAll('.range-field input');
        for (const [index, value] of [first, last].entries()) { fields[index].value = value; fields[index].dispatchEvent(new Event('input', { bubbles: true })); }
        fields[2].value = '批量下载测试'; fields[2].dispatchEvent(new Event('input', { bubbles: true }));
      }, { first, last });
      await popup.evaluate(() => document.querySelector('.range-preview').click());
    };
    await fillRange(base + '/w/999-0-0.html', base + '/w/123-1-4.html');
    await popup.waitForFunction(() => Boolean(document.querySelector('.series-section [role="alert"]')));
    assert.equal(await popup.evaluate(() => document.querySelector('.batch-start')), null);
    const rejected = await popup.evaluate(async base => chrome.runtime.sendMessage({ type: 'ENQUEUE_EPISODE_RANGE', firstUrl: base + '/w/999-0-0.html', lastUrl: base + '/w/123-1-4.html', selectedIds: ['0'], title: '错误范围' }), base);
    assert(rejected.error, 'Worker must independently reject incompatible ranges');
    await fillRange(base + '/w/999-0-0.html', base + '/w/999-0-4.html');
    await popup.waitForFunction(() => document.querySelectorAll('.episode-grid input:checked').length === 5);
    await popup.evaluate(() => Array.from(document.querySelectorAll('.series-tools button')).find(button => button.textContent === '全不选').click());
    await popup.waitForFunction(() => document.querySelectorAll('.episode-grid input:checked').length === 0);
    await popup.evaluate(() => Array.from(document.querySelectorAll('.series-tools button')).find(button => button.textContent === '全选').click());
    await popup.waitForFunction(() => document.querySelectorAll('.episode-grid input:checked').length === 5);
    await popup.screenshot({ path: path.join(root, 'ui-series-preview.png') });
    await popup.evaluate(() => document.querySelector('.batch-start').click());
    let tasks = await waitFor(tasks => tasks.length === 5 && tasks.filter(task => task.stage === 'resolving').length === 2);
    assert.equal(tasks.filter(task => task.stage === 'queued').length, 3);
    assert.equal(await badge(), '1');
    await popup.evaluate(() => document.querySelector('#tab-downloads').click());
    await popup.waitForFunction(() => document.querySelector('#panel-downloads').style.display !== 'none');
    await popup.screenshot({ path: path.join(root, 'ui-downloads-preview.png') });
    assert.equal(await popup.evaluate(() => document.querySelector('.clear-completed').disabled), true);
    await popup.evaluate(() => document.querySelector('#tab-captures').click());
    assert.equal(await popup.evaluate(() => document.querySelector('#panel-captures').textContent.includes('/captured.mp4')), true);
    await popup.evaluate(() => document.querySelector('#tab-series').click());
    result.push('真实工具栏 popup 首尾链接生成、前后端拒绝错误范围、全选/全不选及五集持久排队，两集并发且角标仍为本页捕获数1');
    await popup.evaluate(() => document.querySelector('.batch-start').click()); await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal((await worker.evaluate(async () => Object.values((await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks))).length, 5);
    for (const task of tasks.filter(task => task.stage === 'queued')) assert(!(await control(task.taskId, 'cancel')).error);
    const cancelledPages = tasks.filter(task => task.stage === 'queued').map(task => new URL(task.episode.url).pathname);
    await popup.close();
    let diagnostic = await context.newPage(); await diagnostic.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    rpcDocument = diagnostic;
    await diagnostic.waitForFunction(async () => Boolean((await chrome.runtime.sendMessage({ type: 'GET_NATIVE_DOWNLOADS' })).tasks));
    worker = context.serviceWorkers().filter(worker => worker.url().startsWith(`chrome-extension://${extensionId}/`)).at(-1);
    tasks = await waitFor(tasks => tasks.filter(task => task.stage === 'downloading' && task.percentage > 0).length === 2);
    const downloading = tasks.filter(task => task.stage === 'downloading');
    assert(!(await control(downloading[0].taskId, 'pause')).error);
    await new Promise(resolve => setTimeout(resolve, 200)); assert.equal(await badge(), '1');
    assert(!(await control(downloading[1].taskId, 'pause')).error);
    await new Promise(resolve => setTimeout(resolve, 200)); assert.equal(await badge(), '1');
    const playbackTabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, base + '/movie/999.html');
    await worker.evaluate(tabId => chrome.action.setBadgeText({ tabId, text: '99' }), playbackTabId);
    await diagnostic.close(); rpcDocument = undefined;
    const version = Array.from(versions.values()).find(version => version.scriptURL.startsWith(`chrome-extension://${extensionId}/`) && version.runningStatus === 'running');
    assert(version); await sw.send('ServiceWorker.stopWorker', { versionId: version.versionId }); await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(versions.get(version.versionId).runningStatus, 'stopped');
    const oldTarget = (await cdp.send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`));
    if (oldTarget) { await cdp.send('Target.closeTarget', { targetId: oldTarget.targetId }); await new Promise(resolve => setTimeout(resolve, 200)); }
    diagnostic = await context.newPage(); await diagnostic.goto(`chrome-extension://${extensionId}/src/popup/index.html`); rpcDocument = diagnostic;
    await diagnostic.waitForFunction(() => document.querySelectorAll('[data-task-id]').length === 5);
    worker = context.serviceWorkers().filter(worker => worker.url().startsWith(`chrome-extension://${extensionId}/`)).at(-1);
    assert(!(await control(downloading[0].taskId, 'resume')).error);
    assert(!(await control(downloading[1].taskId, 'resume')).error);
    await new Promise(resolve => setTimeout(resolve, 200)); assert.equal(await badge(), '1');
    assert.equal(await worker.evaluate(tabId => chrome.action.getBadgeText({ tabId }), playbackTabId), '1', 'Worker restart must restore the current page capture count');
    result.push('关闭popup后下载继续，暂停/下载/完成均不改变本页捕获角标；worker重启将旧99恢复为本页捕获数1');
    tasks = await waitFor(tasks => tasks.filter(task => task.stage === 'completed').length === 2);
    await new Promise(resolve => setTimeout(resolve, 200)); assert.equal(await badge(), '1');
    for (const task of tasks.filter(task => task.stage === 'completed')) {
      const item = await worker.evaluate(async id => (await chrome.downloads.search({ id }))[0], task.downloadId);
      assert.deepEqual(await fs.readFile(item.filename), Buffer.concat(chunks));
    }
    assert(!requests.some(request => cancelledPages.includes(request.url)), 'Cancelled queued episodes must never be resolved');
    result.push('每集嵌套播放器 Referer 保留、合并输出字节一致、完成仍显示本页捕获数；排队取消不打开页面');
    const retryTask = tasks.find(task => task.stage === 'cancelled'); assert(!(await control(retryTask.taskId, 'retry')).error);
    await waitFor(tasks => tasks.find(task => task.taskId === retryTask.taskId)?.stage === 'completed');
    result.push('重复批次不会新增任务，取消剧集重试重新解析后完成');
    const blankTab = await worker.evaluate(() => chrome.tabs.create({ url: 'about:blank', active: false }));
    await diagnostic.evaluate(async ({ template, tabId }) => {
      const stored = (await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks;
      stored['persisted-resolver'] = { taskId: 'persisted-resolver', episode: { ...template.episode, url: template.episode.url.replace('-0-', '-1-'), lineId: '1', lineName: '备用' }, ruleId: 0, stage: 'resolving', percentage: 0, runId: crypto.randomUUID(), resolutionStartedAt: Date.now(), resolverTabId: tabId, startedAt: Date.now() };
      await chrome.storage.local.set({ nativeDownloadTasks: stored });
    }, { template: retryTask, tabId: blankTab.id });
    await waitFor(tasks => tasks.find(task => task.taskId === 'persisted-resolver')?.stage === 'completed');
    result.push('已持久化但尚未导航的解析标签可恢复导航并完成下载');
    await diagnostic.close(); rpcDocument = undefined;
    await page.bringToFront(); popup = await openPopup();
    const stored = await popup.evaluate(async () => (await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks);
    const savedFiles = await worker.evaluate(async ids => Promise.all(ids.map(async id => (await chrome.downloads.search({ id }))[0].filename)), Object.values(stored).filter(task => task.stage === 'completed').map(task => task.downloadId));
    await popup.evaluate(async () => {
      const tasks = (await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks;
      tasks['keep-running'] = { taskId: 'keep-running', stage: 'downloading', percentage: 35, candidate: { title: '保留下载中', url: 'https://example.test/active.mp4', kind: 'mp4' }, ruleId: 0, startedAt: 1 };
      tasks['keep-waiting'] = { taskId: 'keep-waiting', stage: 'queued', percentage: 0, candidate: { title: '保留等待下载', url: 'https://example.test/queued.mp4', kind: 'mp4' }, ruleId: 0, queueOrder: 6, startedAt: 2 };
      tasks['keep-paused'] = { taskId: 'keep-paused', queueOrder: 7, stage: 'paused', percentage: 42, candidate: { title: '保留暂停任务', url: 'https://example.test/pause.mp4', kind: 'mp4' }, ruleId: 0 };
      tasks['keep-failed'] = { taskId: 'keep-failed', stage: 'failed', percentage: 0, candidate: { title: '保留失败记录', url: 'https://example.test/fail.mp4', kind: 'mp4' }, ruleId: 0, errorMessage: '测试失败' };
      await chrome.storage.local.set({ nativeDownloadTasks: tasks });
    });
    await popup.evaluate(() => document.querySelector('#tab-downloads').click());
    await popup.waitForFunction(() => !document.querySelector('.clear-completed').disabled && document.querySelector('[data-task-id="keep-running"]'));
    const ordered = await popup.evaluate(() => Array.from(document.querySelectorAll('[data-task-id]')).map(card => card.dataset.taskId));
    assert.deepEqual(ordered.slice(0, 3), ['keep-running', 'keep-waiting', 'keep-paused']);
    const ranks = ordered.map(id => stored[id]?.stage === 'completed' ? 3 : id === 'keep-running' ? 0 : ['keep-waiting', 'keep-paused'].includes(id) ? 1 : 2);
    assert(ranks.every((rank, i) => !i || rank >= ranks[i - 1]));
    result.push('任务列表按运行、等待/暂停、需要重试、完成分组，等待按入队顺序排列');
    await popup.evaluate(() => document.querySelector('.clear-completed').click());
    await popup.waitForFunction(async () => Object.values((await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks).every(task => task.stage !== 'completed') && document.querySelector('.clear-completed').disabled);
    const kept = await popup.evaluate(async () => (await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks);
    assert.equal(kept['keep-running'].stage, 'downloading'); assert.equal(kept['keep-waiting'].stage, 'queued'); assert.equal(kept['keep-paused'].stage, 'paused'); assert.equal(kept['keep-failed'].stage, 'failed'); assert(Object.values(kept).some(task => task.stage === 'cancelled'));
    for (const filename of savedFiles) assert.deepEqual(await fs.readFile(filename), Buffer.concat(chunks));
    result.push('清空完成记录在持久存储生效，实际下载文件字节仍一致，暂停/失败/取消任务保留');
    await popup.screenshot({ path: path.join(root, 'ui-downloads-sorted-preview.png') });
    await popup.evaluate(() => document.querySelector('#tab-series').click());
    await popup.waitForFunction(() => Boolean(document.querySelectorAll('.range-field input')[0]?.value));
    assert.equal(await popup.evaluate(() => document.querySelectorAll('.range-field input')[0].value), base + '/w/999-0-0.html');
    await popup.evaluate(() => document.querySelector('.range-preview').click());
    await popup.waitForFunction(() => document.querySelectorAll('.episode-grid input').length === 5);
    result.push('弹窗关闭重开保留首尾链接草稿，需重新生成范围后下载');
    await popup.evaluate(() => document.querySelector('.series-section').scrollIntoView());
    await popup.screenshot({ path: path.join(root, 'range-preview.png') });
    await popup.evaluate(() => document.querySelector('.clear-range').click());
    await popup.waitForFunction(async () => { const draft = (await chrome.storage.local.get('episodeRangeDraft')).episodeRangeDraft; return draft?.firstUrl === '' && draft.lastUrl === '' && draft.title === '' && !document.querySelector('.batch-start'); });
    assert.equal(await popup.evaluate(() => Array.from(document.querySelectorAll('.range-field input')).every(input => input.value === '')), true);
    await popup.close(); await page.bringToFront(); popup = await openPopup();
    await popup.evaluate(() => document.querySelector('#tab-series').click());
    await popup.waitForFunction(() => Array.from(document.querySelectorAll('.range-field input')).every(input => input.value === '') && !document.querySelector('.batch-start'));
    await popup.screenshot({ path: path.join(root, 'ui-series-cleared-preview.png') });
    result.push('清空批量首尾链接及作品名称，同时移除生成列表和选择；关闭重开草稿仍为空');
    await popup.close();
    }
    let liveAcceptance;
    if (process.env.LIVE_RANGE_FIRST) {
      await page.goto(process.env.LIVE_RANGE_FIRST, { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.bringToFront();
      popup = await openPopup(); await popup.evaluate(() => document.querySelector('#tab-series').click());
      await popup.evaluate(({first, last}) => {
        const fields = document.querySelectorAll('.range-field input');
        for (const [index, value] of [first, last].entries()) { fields[index].value = value; fields[index].dispatchEvent(new Event('input', { bubbles: true })); }
        fields[2].value = 'LibVio 批量验证'; fields[2].dispatchEvent(new Event('input', { bubbles: true }));
      }, { first: process.env.LIVE_RANGE_FIRST, last: process.env.LIVE_RANGE_LAST });
      await popup.evaluate(() => document.querySelector('.range-preview').click());
      await popup.waitForFunction(() => document.querySelectorAll('.episode-grid input:checked').length === 2);
      await popup.screenshot({ path: path.join(root, 'range-live-preview.png') });
      await popup.evaluate(() => document.querySelector('.batch-start').click()); await popup.close();
      const diagnostic = await context.newPage(); await diagnostic.goto(`chrome-extension://${extensionId}/src/popup/index.html`); rpcDocument = diagnostic;
      let liveTasks;
      try {
        for (let index = 0; index < 150; index++) {
          liveTasks = await worker.evaluate(async () => Object.values((await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks || {}));
          if (index % 10 === 0) console.log(JSON.stringify({ live: liveTasks.map(task => ({ title: task.candidate.title, stage: task.stage, percentage: task.percentage, error: task.errorMessage, mediaUrl: task.requestCandidate?.url })) }));
          if (liveTasks.some(task => task.stage === 'failed')) throw new Error(JSON.stringify(liveTasks));
          if (liveTasks.length === 2 && liveTasks.every(task => task.requestCandidate && ['downloading','completed','paused'].includes(task.stage))) {
            for (const task of liveTasks.filter(task => task.stage === 'downloading' && task.phase !== 'saving')) assert(!(await control(task.taskId, 'pause')).error);
            assert.notEqual(liveTasks[0].requestCandidate.url, liveTasks[1].requestCandidate.url);
            liveAcceptance = { first: process.env.LIVE_RANGE_FIRST, last: process.env.LIVE_RANGE_LAST, tasks: liveTasks, boundary: '真实两个播放页独立解析媒体并进入下载；暂停取消，未完整下载或解码整集' }; break;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        assert(liveAcceptance, 'Live range media resolution timed out');
        result.push('用户指定 LibVio 首尾范围，真实两集分别解析不同媒体并启动后台下载');
      } finally {
        for (const task of liveTasks || []) if (!['completed','failed','cancelled'].includes(task.stage)) await control(task.taskId, 'cancel');
      }
    }
    await fs.writeFile(path.join(root, process.env.LIVE_RANGE_FIRST ? 'range-live-validation.json' : 'range-validation.json'), JSON.stringify({ version: JSON.parse(await fs.readFile(path.join(root, 'dist/manifest.json'), 'utf8')).version, at: new Date().toISOString(), checks: result, liveAcceptance, requests }, null, 2));
    console.log(JSON.stringify({ checks: result, liveAcceptance: liveAcceptance?.media }, null, 2));
  } finally {
    if (context) await context.close(); await new Promise(resolve => server.close(resolve));
    assert(temp.startsWith(root + path.sep + '.series-test-')); await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
