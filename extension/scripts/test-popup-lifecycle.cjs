const { chromium } = require('../../windows/node_modules/playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createCipheriv } = require('node:crypto');

(async () => {
  const root = path.resolve(__dirname, '..');
  const temp = await fs.mkdtemp(path.join(root, '.popup-test-'));
  const payload = Buffer.alloc(256 * 1024, 42); payload.writeUInt32BE(24); payload.write('ftypisom', 4);
  const requests = [];
  const hlsRequests = [];
  const pngPrefix = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489000000017352474200aece1ce90000000467414d410000b18f0bfc61050000000970485973000012740000127401de661f780000000d49444154185763f8ffffff7f0009fb03fd054345ca0000000049454e44ae426082', 'hex');
  const hlsKey = Buffer.alloc(16, 31);
  const explicitIv = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const segments = Array.from({ length: 36 }, (_, index) => {
    const bytes = Buffer.alloc(188 * 4, index);
    for (let offset = 0; offset < bytes.length; offset += 188) bytes[offset] = 0x47;
    return bytes;
  });
  const encryptedSegments = segments.map((bytes, index) => {
    const iv = index < 18 ? explicitIv : Buffer.alloc(16);
    if (index >= 18) iv.writeBigUInt64BE(BigInt(index + 7), 8);
    const cipher = createCipheriv('aes-128-cbc', hlsKey, iv);
    return Buffer.concat([cipher.update(index % 2 ? Buffer.concat([pngPrefix, bytes]) : bytes), cipher.final()]);
  });
  let base;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/hls/')) {
      hlsRequests.push({ url: req.url, referer: req.headers.referer });
      if (req.url !== '/hls/master.m3u8' && !req.headers.referer?.startsWith(base)) { res.statusCode = 403; res.end('Missing playback source'); return; }
      if (req.url === '/hls/master.m3u8') {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720\nunused.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1600000,RESOLUTION=1920x1080\nmedia.m3u8\n'); return;
      }
      if (req.url === '/hls/media.m3u8') {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.end('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:7\n' + segments.map((_, index) =>
          (index === 0 ? '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x00112233445566778899aabbccddeeff\n' : index === 18 ? '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n' : '') + `#EXTINF:1,\nseg${index}.ts\n`).join('') + '#EXT-X-ENDLIST\n'); return;
      }
      if (req.url === '/hls/key.bin') { res.end(hlsKey); return; }
      const match = req.url.match(/^\/hls\/seg(\d+)\.ts$/);
      if (match) {
        res.setHeader('Content-Type', Number(match[1]) % 2 ? 'image/png' : 'video/mp2t');
        const timer = setTimeout(() => res.end(encryptedSegments[Number(match[1])]), 1300);
        res.on('close', () => clearTimeout(timer)); return;
      }
      if (/^\/hls\/(png-only|truncated|corrupt)\.m3u8$/.test(req.url)) { res.end('#EXTM3U\n#EXTINF:1,\n' + req.url.split('/').at(-1).replace('.m3u8', '.png') + '\n#EXT-X-ENDLIST\n'); return; }
      if (req.url === '/hls/png-only.png') { res.setHeader('Content-Type', 'image/png'); res.end(pngPrefix); return; }
      if (req.url === '/hls/truncated.png') { res.setHeader('Content-Type', 'image/png'); res.end(Buffer.concat([pngPrefix, segments[0].subarray(0, -1)])); return; }
      if (req.url === '/hls/corrupt.png') { const corrupt = Buffer.from(segments[0]); corrupt[188] = 0; res.setHeader('Content-Type', 'image/png'); res.end(Buffer.concat([pngPrefix, corrupt])); return; }
      if (req.url === '/hls/bad.m3u8') { res.end('#EXTM3U\n#EXTINF:1,\nhtml.ts\n#EXT-X-ENDLIST\n'); return; }
      res.setHeader('Content-Type', 'text/html'); res.end('<html>Forbidden</html>'); return;
    }
    if (!req.url.startsWith('/video.mp4')) { res.setHeader('Content-Type', 'text/html'); res.end('<title>页面切换测试</title>'); return; }
    if (!req.headers.referer?.startsWith(base)) { res.statusCode = 403; res.end('Missing playback source'); return; }
    requests.push(req.headers.range || 'full');
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), payload.length - 1) : payload.length - 1;
    res.setHeader('Content-Type', 'video/mp4'); res.setHeader('ETag', '"lifecycle-v1"');
    res.setHeader('Content-Length', end - start + 1);
    if (range) { res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${payload.length}`); res.end(payload.subarray(start, end + 1)); return; }
    let cursor = 0;
    const timer = setInterval(() => {
      const end = Math.min(cursor + 16 * 1024, payload.length); res.write(payload.subarray(cursor, end)); cursor = end;
      if (cursor === payload.length) { clearInterval(timer); res.end(); }
    }, 700);
    res.on('close', () => clearInterval(timer));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  let context;
  await fs.mkdir(path.join(temp, 'profile', 'Default'), { recursive: true });
  await fs.mkdir(path.join(temp, 'downloads'), { recursive: true });
  await fs.writeFile(path.join(temp, 'profile', 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: path.join(temp, 'downloads'), prompt_for_download: false } }));
  try {
    context = await chromium.launchPersistentContext(path.join(temp, 'profile'), { executablePath: process.env.CHROME_TEST_EXE,
      headless: true, args: [`--load-extension=${path.join(root, 'dist')}`, `--disable-extensions-except=${path.join(root, 'dist')}`], acceptDownloads: true });
    let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' });
    const page = await context.newPage(); await page.goto(base + '/one');
    const versions = new Map();
    const sw = await context.newCDPSession(page);
    sw.on('ServiceWorker.workerVersionUpdated', event => { for (const version of event.versions) versions.set(version.versionId, version); });
    await sw.send('ServiceWorker.enable');
    const patchSaving = async () => worker.evaluate(() => {
      const native = chrome.downloads.download.bind(chrome.downloads);
      globalThis.savedDownloads = globalThis.savedDownloads || [];
      chrome.downloads.download = async options => {
        const id = await native(options);
        globalThis.savedDownloads.push({ id, filename: options.filename, saveAs: options.saveAs }); return id;
      };
    });
    await patchSaving();
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
      await popup.evaluate(() => document.querySelector('#tab-downloads').click());
      return popup;
    };
    let popup = await openPopup();
    await popup.evaluate(candidate => chrome.runtime.sendMessage({ type: 'START_NATIVE_DOWNLOAD', candidate }),
      { id: 'lifecycle', url: base + '/video.mp4', sourceUrl: base + '/one', kind: 'mp4', title: '真实工具栏生命周期', capturedAt: Date.now() });
    await popup.waitForFunction(() => /下载中/.test(document.querySelector('[data-task-id="lifecycle"]')?.textContent || ''));
    await popup.close();
    const other = await context.newPage(); await other.goto(base + '/two');
    popup = await openPopup();
    await popup.waitForFunction(() => /下载中/.test(document.querySelector('[data-task-id="lifecycle"]')?.textContent || ''));
    await popup.clickTaskButton('暂停');
    await popup.waitForFunction(() => /已暂停/.test(document.querySelector('[data-task-id="lifecycle"]')?.textContent || ''));
    const before = await popup.evaluate(async () => (await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks.lifecycle);
    await popup.close();
    let version = Array.from(versions.values()).find(v => v.scriptURL.startsWith(`chrome-extension://${extensionId}/`) && v.runningStatus === 'running');
    assert(version, 'ServiceWorker version not observed');
    await sw.send('ServiceWorker.stopWorker', { versionId: version.versionId });
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(JSON.stringify({ afterStop: Array.from(versions.values()).map(v => ({ script: v.scriptURL, status: v.runningStatus })) }));
    assert.equal(versions.get(version.versionId).runningStatus, 'stopped');
    const oldWorkerTarget = (await cdp.send('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extensionId}/`));
    if (oldWorkerTarget) {
      console.log(JSON.stringify(await cdp.send('Target.closeTarget', { targetId: oldWorkerTarget.targetId })));
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    // Wake the replacement worker from a page that does not hold the old popup alive.
    const diagnostic = await context.newPage(); await diagnostic.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await diagnostic.waitForFunction(() => /已暂停/.test(document.querySelector('[data-task-id="lifecycle"]')?.textContent || ''));
    worker = context.serviceWorkers().find(w => w.url().startsWith(`chrome-extension://${extensionId}/`));
    assert(worker, 'Replacement worker not started'); await patchSaving();
    const duplicate = await diagnostic.evaluate(candidate => chrome.runtime.sendMessage({ type: 'START_NATIVE_DOWNLOAD', candidate }),
      { id: 'new-capture-id', url: base + '/video.mp4#t=50', sourceUrl: base + '/two', kind: 'mp4', title: '重新捕获', capturedAt: Date.now() });
    assert.equal(duplicate.task.taskId, 'lifecycle');
    await diagnostic.close();
    popup = await openPopup();
    await popup.waitForFunction(() => /已暂停/.test(document.querySelector('[data-task-id="lifecycle"]')?.textContent || ''));
    const after = await popup.evaluate(async () => (await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks.lifecycle);
    assert.equal(after.percentage, before.percentage);
    await popup.clickTaskButton('继续');
    await popup.close();
    await new Promise(resolve => setTimeout(resolve, 1200));
    popup = await openPopup();
    await popup.waitForFunction(() => /完成 \(100%\)/.test(document.querySelector('[data-task-id="lifecycle"]')?.textContent || ''), { timeout: 20000 });
    const final = await popup.evaluate(async () => (await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks.lifecycle);
    assert.equal(final.stage, 'completed');
    const item = await worker.evaluate(async id => (await chrome.downloads.search({ id }))[0], final.downloadId);
    assert.deepEqual(await fs.readFile(item.filename), payload);
    await popup.evaluate(candidate => chrome.runtime.sendMessage({ type: 'START_NATIVE_DOWNLOAD', candidate }),
      { id: 'active-restart', url: base + '/video.mp4', sourceUrl: base + '/two', kind: 'mp4', title: '下载中后台重启', capturedAt: Date.now() });
    await popup.waitForFunction(() => /下载中/.test(document.querySelector('[data-task-id="active-restart"]')?.textContent || ''));
    await popup.close();
    version = Array.from(versions.values()).find(v => v.scriptURL.startsWith(`chrome-extension://${extensionId}/`) && v.runningStatus === 'running');
    await sw.send('ServiceWorker.stopWorker', { versionId: version.versionId });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(versions.get(version.versionId).runningStatus, 'stopped');
    const probe = await context.newPage(); await probe.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await probe.waitForFunction(() => /下载中/.test(document.querySelector('[data-task-id="active-restart"]')?.textContent || ''));
    worker = context.serviceWorkers().find(w => w.url().startsWith(`chrome-extension://${extensionId}/`)); await patchSaving();
    await probe.close();
    await new Promise(resolve => setTimeout(resolve, 12000));
    popup = await openPopup();
    await popup.waitForFunction(() => /完成 \(100%\)/.test(document.querySelector('[data-task-id="active-restart"]')?.textContent || ''));
    const activeFinal = await popup.evaluate(async () => (await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks['active-restart']);
    const activeItem = await worker.evaluate(async id => (await chrome.downloads.search({ id }))[0], activeFinal.downloadId);
    assert.deepEqual(await fs.readFile(activeItem.filename), payload);
    await popup.evaluate(candidate => chrome.runtime.sendMessage({ type: 'START_NATIVE_DOWNLOAD', candidate }),
      { id: 'lost-buffer', url: base + '/video.mp4', sourceUrl: base + '/two', kind: 'mp4', title: '暂存结束后恢复', capturedAt: Date.now() });
    await popup.waitForFunction(() => /下载中/.test(document.querySelector('[data-task-id="lost-buffer"]')?.textContent || ''));
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CONTROL_NATIVE_DOWNLOAD', taskId: 'lost-buffer', action: 'pause' }));
    await worker.evaluate(async () => {
      await chrome.offscreen.closeDocument();
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map(rule => rule.id) });
    });
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CONTROL_NATIVE_DOWNLOAD', taskId: 'lost-buffer', action: 'resume' }));
    await popup.waitForFunction(() => /完成 \(100%\)/.test(document.querySelector('[data-task-id="lost-buffer"]')?.textContent || ''), { timeout: 20000 });
    const recovered = await popup.evaluate(async () => (await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks['lost-buffer']);
    const recoveredItem = await worker.evaluate(async id => (await chrome.downloads.search({ id }))[0], recovered.downloadId);
    assert.deepEqual(await fs.readFile(recoveredItem.filename), payload);

    // Exercise the actual HLS button, then the real toolbar popup lifecycle.
    await popup.close(); await page.bringToFront();
    await page.evaluate(() => fetch('/hls/master.m3u8').then(response => response.text()));
    popup = await openPopup();
    await popup.evaluate(() => document.querySelector('#tab-captures').click());
    await popup.waitForFunction(() => Array.from(document.querySelectorAll('.candidate-card')).some(card => card.textContent.includes('/hls/master.m3u8') && card.querySelector('select')));
    await popup.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.candidate-card')).find(card => card.textContent.includes('/hls/master.m3u8'));
      const select = card.querySelector('select');
      if (select) { select.value = '1080p'; select.dispatchEvent(new Event('change', { bubbles: true })); }
      card.querySelector('button.btn-primary').click();
    });
    await popup.evaluate(() => document.querySelector('#tab-downloads').click());
    await popup.waitForFunction(() => Array.from(document.querySelectorAll('[data-task-id]')).some(card => card.textContent.includes('/hls/master.m3u8') && /下载中/.test(card.textContent)));
    let hlsTask = await popup.evaluate(async () => Object.values((await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks).find(task => task.candidate.kind === 'hls'));
    assert.equal(hlsTask.requestCandidate.quality, '1080p');
    const hlsTaskId = hlsTask.taskId;
    await popup.close(); await other.bringToFront(); popup = await openPopup();
    assert.equal(await popup.evaluate(id => Boolean(document.querySelector(`[data-task-id="${id}"]`)), hlsTaskId), true);
    await popup.waitForFunction(() => Array.from(document.querySelectorAll('[data-task-id]')).some(card => card.textContent.includes('已获取') && !card.textContent.includes('已获取 0/')));
    const hlsControl = async action => {
      const response = await popup.evaluate(({ id, action }) => chrome.runtime.sendMessage({ type: 'CONTROL_NATIVE_DOWNLOAD', taskId: id, action }), { id: hlsTaskId, action });
      assert(!response.error, JSON.stringify(response)); return response.task;
    };
    const pausedHls = await hlsControl('pause');
    assert(pausedHls.percentage > 0 && pausedHls.percentage < 99, JSON.stringify(pausedHls));
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.equal(await popup.evaluate(async id => (await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks[id].percentage, hlsTaskId), pausedHls.percentage);
    await popup.close(); await page.bringToFront(); popup = await openPopup();
    await popup.waitForFunction(() => Array.from(document.querySelectorAll('[data-task-id]')).some(card => card.textContent.includes('/hls/master.m3u8') && /已暂停/.test(card.textContent)));
    await popup.waitForFunction(() => Array.from(document.querySelectorAll('.candidate-card')).some(card => !card.hasAttribute('data-task-id') && card.textContent.includes('/hls/master.m3u8') && card.textContent.includes('已暂停')));
    const hlsDuplicate = await popup.evaluate(candidate => chrome.runtime.sendMessage({ type: 'START_NATIVE_DOWNLOAD', candidate }),
      { ...hlsTask.requestCandidate, id: 'hls-recaptured', url: base + '/hls/master.m3u8#t=5' });
    assert.equal(hlsDuplicate.task.taskId, hlsTaskId);
    await popup.close();
    version = Array.from(versions.values()).find(v => v.scriptURL.startsWith(`chrome-extension://${extensionId}/`) && v.runningStatus === 'running');
    await sw.send('ServiceWorker.stopWorker', { versionId: version.versionId });
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(versions.get(version.versionId).runningStatus, 'stopped');
    const hlsProbe = await context.newPage(); await hlsProbe.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await hlsProbe.waitForFunction(() => Array.from(document.querySelectorAll('[data-task-id]')).some(card => card.textContent.includes('/hls/master.m3u8') && /已暂停/.test(card.textContent)));
    worker = context.serviceWorkers().find(w => w.url().startsWith(`chrome-extension://${extensionId}/`)); await patchSaving();
    await hlsProbe.close(); popup = await openPopup();
    await hlsControl('resume'); await popup.close();
    await new Promise(resolve => setTimeout(resolve, 10000));
    popup = await openPopup();
    await popup.waitForFunction(() => Array.from(document.querySelectorAll('[data-task-id]')).some(card => card.textContent.includes('/hls/master.m3u8') && /完成 \(100%\)/.test(card.textContent)), { timeout: 20000 });
    hlsTask = await popup.evaluate(async id => (await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks[id], hlsTaskId);
    const hlsItem = await worker.evaluate(async id => (await chrome.downloads.search({ id }))[0], hlsTask.downloadId);
    // CDP/Playwright can assign a Blob UUID to the actual fixture path. Verify
    // the filename supplied to Chrome separately from byte-for-byte disk output.
    assert.match(await worker.evaluate(id => globalThis.savedDownloads.find(item => item.id === id).filename, hlsTask.downloadId), /\.ts$/);
    assert.deepEqual(await fs.readFile(hlsItem.filename), Buffer.concat(segments));
    assert.equal(hlsRequests.filter(request => request.url === '/hls/seg0.ts').length, 1, 'Completed HLS segments must survive pause/resume');
    assert.equal(hlsRequests.some(request => request.url === '/hls/unused.m3u8'), false, 'Selected quality must be preserved');
    const hlsCandidate = { id: 'hls-cancel', url: base + '/hls/media.m3u8', sourceUrl: base + '/one', kind: 'hls', title: 'HLS 取消重试', capturedAt: Date.now() };
    await popup.evaluate(candidate => chrome.runtime.sendMessage({ type: 'START_NATIVE_DOWNLOAD', candidate }), hlsCandidate);
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CONTROL_NATIVE_DOWNLOAD', taskId: 'hls-cancel', action: 'cancel' }));
    await new Promise(resolve => setTimeout(resolve, 1600));
    assert.equal(await popup.evaluate(async () => (await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks['hls-cancel'].stage), 'cancelled');
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CONTROL_NATIVE_DOWNLOAD', taskId: 'hls-cancel', action: 'retry' }));
    await popup.waitForFunction(() => /完成 \(100%\)/.test(document.querySelector('[data-task-id="hls-cancel"]')?.textContent || ''), { timeout: 20000 });
    const retriedHls = await popup.evaluate(async () => (await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks['hls-cancel']);
    const retriedItem = await worker.evaluate(async id => (await chrome.downloads.search({ id }))[0], retriedHls.downloadId);
    assert.deepEqual(await fs.readFile(retriedItem.filename), Buffer.concat(segments));
    await popup.evaluate(candidate => chrome.runtime.sendMessage({ type: 'START_NATIVE_DOWNLOAD', candidate }), { ...hlsCandidate, id: 'hls-html', url: base + '/hls/bad.m3u8' });
    await popup.waitForFunction(() => /失败/.test(document.querySelector('[data-task-id="hls-html"]')?.textContent || ''));
    const failedHls = await popup.evaluate(async () => (await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks['hls-html']);
    assert.equal(failedHls.downloadId, undefined);
    assert.equal((await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).length, 0);
    for (const variant of ['png-only', 'truncated', 'corrupt']) {
      const id = 'hls-' + variant;
      await popup.evaluate(candidate => chrome.runtime.sendMessage({ type: 'START_NATIVE_DOWNLOAD', candidate }), { ...hlsCandidate, id, url: base + '/hls/' + variant + '.m3u8' });
      await popup.waitForFunction(new Function(`return /失败/.test(document.querySelector('[data-task-id="${id}"]')?.textContent || '')`));
      const rejected = await popup.evaluate(async id => (await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks[id], id);
      assert.equal(rejected.downloadId, undefined);
      assert.equal((await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).length, 0);
    }
    assert.equal(hlsTask.diagnostics.normalizedSegments, 18);
    assert.equal(hlsTask.diagnostics.removedPrefixBytes, pngPrefix.length * 18);
    const requestedSaves = await worker.evaluate(() => globalThis.savedDownloads);
    assert(requestedSaves.length > 0 && requestedSaves.every(item => item.saveAs === false));
    assert(retriedItem.filename.startsWith(path.join(temp, 'downloads') + path.sep), 'Chrome must use its configured default download directory');
    const hlsChecks = ['HLS 由真正 popup 下载按钮启动并进入持久全局列表', '关闭 popup 切换标签页后 HLS 进度可见', '返回原页候选关联同一暂停任务且不重复下载', 'HLS 暂停进度不变、继续保留已完成分片', 'HLS worker 停止后暂停记录及完成事件可恢复', 'HLS 关闭 popup 后合并完成并保存 TS', '指定 1080p、AES-128 显式 IV 和序列隐式 IV 解密字节一致', 'HLS 取消及重试不受旧回调污染', '拒绝 HTML 分片且清理请求规则', 'PNG 封装分片在 AES 解密后移除，暂停恢复后诊断数量及落盘字节一致', '真正图片和截断 PNG/TS 分片不创建下载文件', 'PNG 内 TS 包中途失去同步时失败并清理规则', '原生自动保存到隔离Chrome配置的默认下载目录，saveAs false自动保存'];
    await fs.writeFile(path.join(root, 'hls-lifecycle-validation.json'), JSON.stringify({ version: JSON.parse(await fs.readFile(path.join(root, 'dist/manifest.json'), 'utf8')).version, at: new Date().toISOString(), checks: hlsChecks, savedBytes: hlsTask.diagnostics.receivedBytes, expectedBytes: Buffer.concat(segments).length, requests: hlsRequests, boundary: '受控 MPEG-TS 字节夹具，非用户真实站点视频解码验收' }, null, 2));
    await popup.screenshot({ path: path.join(root, 'popup-lifecycle-preview.png') });
    const report = { browser: await context.browser().version(), version: JSON.parse(await fs.readFile(path.join(root, 'dist/manifest.json'), 'utf8')).version, at: new Date().toISOString(),
      checks: ['真正 chrome.action.openPopup 工具栏弹窗', '关闭弹窗并切换网页后任务可见', '强制停止并重新启动 service worker 后恢复暂停任务', '新捕获 ID/fragment 不启动重复任务', '继续后关闭弹窗仍完成并可恢复', '下载途中重启 worker 后完成事件仍被接收并保存', '后台文档及请求规则丢失后可恢复请求来源并重新下载', '落盘字节与源文件一致', ...hlsChecks], requests };
    await fs.writeFile(path.join(root, 'popup-lifecycle-validation.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (context) await context.close();
    await new Promise(resolve => server.close(resolve));
    assert(temp.startsWith(root + path.sep + '.popup-test-')); await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });


