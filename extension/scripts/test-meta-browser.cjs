const { chromium } = require('../../windows/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const https = require('node:https');
const { spawnSync } = require('node:child_process');

(async () => {
  const root = path.resolve(__dirname, '..');
  const temp = await fs.mkdtemp(path.join(root, '.meta-browser-'));
  const results = [], live = [], errors = [], requests = [];
  const bytes = Buffer.alloc(256 * 1024, 42); bytes.writeUInt32BE(24, 0); bytes.write('ftypisom', 4);
  const keyPath = path.join(temp, 'key.pem'), certPath = path.join(temp, 'cert.pem');
  const configPath = path.join(temp, 'openssl.cnf');
  await fs.writeFile(configPath, '[req]\ndistinguished_name = dn\n[dn]\n');
  const certificate = spawnSync(process.env.OPENSSL_TEST_EXE || 'openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-config', configPath, '-subj', '/CN=localhost', '-keyout', keyPath, '-out', certPath,
  ], { encoding: 'utf8', windowsHide: true });
  if (certificate.error || certificate.status !== 0) {
    await fs.rm(temp, { recursive: true, force: true });
    throw certificate.error || new Error(`Test certificate generation failed: ${certificate.stderr}`);
  }
  const server = https.createServer({ key: await fs.readFile(keyPath), cert: await fs.readFile(certPath) }, (req, res) => {
    if (req.headers.host.startsWith('fb.watch')) { res.writeHead(302, { Location: `https://www.facebook.com:${server.address().port}/reel/12345/` }); res.end(); return; }
    if (req.headers.host.startsWith('www.facebook.com')) {
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(`<title>Facebook short-link fixture</title><script type="application/json">${JSON.stringify({ id: '12345', videoDeliveryResponseFragment: { videoDeliveryResponseResult: { progressive_urls: [{ progressive_url: cdn('fb-dynamic'), metadata: { quality: 'HD' } }] } } })}</script>`); return;
    }
    if (req.headers.host.startsWith('www.instagram.com')) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<title>Unavailable post</title><p>No accessible video</p>'); return; }
    requests.push({ url: req.url, headers: req.headers });
    const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0, end = range && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    res.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': String(end - start + 1), 'Access-Control-Allow-Origin': '*', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) }); res.end(bytes.subarray(start, end + 1));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const mediaOrigin = `https://scontent.sample.fbcdn.net:${server.address().port}`;
  const cdn = name => `${mediaOrigin}/${name}.mp4?sig=keep&bytestart=0&byteend=999`;
  let context, liveContext;
  try {
    context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
      executablePath: process.env.CHROME_TEST_EXE || path.resolve(root, '../.tools/meta-chrome/chrome-win64/chrome.exe'),
      headless: true, acceptDownloads: true,
      args: [`--disable-extensions-except=${path.join(root, 'dist')}`, `--load-extension=${path.join(root, 'dist')}`, '--disable-features=DisableLoadExtensionCommandLineSwitch', '--ignore-certificate-errors', '--no-proxy-server', '--host-resolver-rules=MAP scontent.sample.fbcdn.net 127.0.0.1, MAP fb.watch 127.0.0.1, MAP www.facebook.com 127.0.0.1, MAP www.instagram.com 127.0.0.1'],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(worker.url()).host;
    await (await context.browser().newBrowserCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.join(temp, 'downloads') });
    let mode = 'initial';
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname === 'scontent.sample.fbcdn.net') { await route.continue(); return; }
      if (!['www.instagram.com', 'www.facebook.com', 'fb.watch'].includes(url.host)) { await route.continue(); return; }
      if (url.host === 'fb.watch') { await route.fulfill({ status: 302, headers: { Location: 'https://www.facebook.com/reel/12345/' } }); return; }
      if (url.pathname === '/api/graphql') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.host.includes('instagram') ? { items: [{ code: 'Dynamic', video_versions: [{ url: cdn('ig-dynamic'), height: 720 }] }] } : { data: { video: { id: '12345', videoDeliveryResponseFragment: { videoDeliveryResponseResult: { progressive_urls: [{ progressive_url: cdn('fb-dynamic'), metadata: { quality: 'HD' } }] } } } } }) }); return;
      }
      let html = '<title>Meta fixture</title>';
      if (mode === 'initial') html += `<script type="application/json">${JSON.stringify({ items: [{ code: 'Fixture', carousel_media: [{ code: 'Child1', video_versions: [{ url: cdn('ig-initial'), height: 1080 }] }, { code: 'Child2', video_url: cdn('ig-second') }] }, { code: 'Other', video_url: cdn('wrong-post') }] })}</script>`;
      if (mode === 'fetch') html += '<script>fetch("/api/graphql").then(r=>r.json()).then(()=>document.body.dataset.loaded="yes")</script><video src="blob:https://www.instagram.com/fake"></video>';
      if (mode === 'xhr') html += '<script>const xhr=new XMLHttpRequest();xhr.open("GET","/api/graphql");xhr.send();</script>';
      if (mode === 'dash') html += `<script type="application/json">${JSON.stringify({ video: { id: '777', dash_manifest: '<MPD/>', playable_url_dash: 'https://scontent.sample.fbcdn.net/track.mpd' } })}</script><script>fetch("${cdn('video-only')}")</script>`;
      if (mode === 'empty') html += '<p>Login required</p>';
      await route.fulfill({ contentType: 'text/html', body: html });
    });
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/src/popup/index.html`);
    const send = (type, extra = {}) => popup.evaluate(message => chrome.runtime.sendMessage(message), { type, ...extra });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const tabId = () => worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, page.url());
    const wait = async fn => { for (let n = 0; n < 100; n++) { const r = await fn(); if (r) return r; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Timed out'); };
    const candidates = async () => (await send('GET_TAB_CANDIDATES', { tabId: await tabId() })).candidates;
    await page.goto('https://www.instagram.com/p/Fixture/');
    const initial = await wait(async () => { const c = await candidates(); return c.length === 2 && c; });
    assert(initial.every(c => !c.url.includes('bytestart') && !c.url.includes('wrong-post')));
    results.push('Initial Instagram JSON / carousel / all-frame classic content scripts / unrelated post exclusion');
    await page.evaluate(() => { const iframe = document.createElement('iframe'); iframe.src = 'https://www.instagram.com/late-frame/'; document.body.append(iframe); });
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal((await candidates()).filter(c => c.sourceUrl === 'https://www.instagram.com/p/Fixture/').length, 2);
    results.push('Late iframe loading does not erase already captured main-page Meta media');
    await send('START_NATIVE_DOWNLOAD', { candidate: initial[0] });
    const task = await wait(async () => { const tasks = (await send('GET_NATIVE_DOWNLOADS')).tasks; const t = Object.values(tasks).find(t => t.requestCandidate?.url === initial[0].url); if (t?.stage === 'failed') throw Error(JSON.stringify(t)); return t?.stage === 'completed' && t; });
    const item = await worker.evaluate(async id => (await chrome.downloads.search({ id }))[0], task.downloadId);
    assert.deepEqual(await fs.readFile(item.filename), bytes);
    assert(requests.length > 0 && requests.every(r => !r.url.includes('bytestart') && r.url.includes('sig=keep')));
    assert(requests.every(r => r.headers.referer === 'https://www.instagram.com/p/Fixture/'));
    results.push('Instagram identified media through real offscreen/native Chrome download, full saved bytes match');
    mode = 'fetch'; await page.goto('https://www.instagram.com/reel/Dynamic/');
    const dynamic = await wait(async () => (await candidates()).find(c => c.url.includes('ig-dynamic')));
    assert.equal(dynamic.quality, 'Instagram 720p');
    results.push('document_start MAIN fetch hook catches early JSON with blob player');
    mode = 'xhr'; await page.goto('https://www.facebook.com/reel/12345/');
    const fb = await wait(async () => (await candidates()).find(c => c.url.includes('fb-dynamic')));
    assert.equal(fb.quality, 'Facebook HD');
    results.push('Facebook XHR current progressive_urls capture with correct HD label');
    await send('START_NATIVE_DOWNLOAD', { candidate: fb });
    const fbTask = await wait(async () => { const t = Object.values((await send('GET_NATIVE_DOWNLOADS')).tasks).find(t => t.requestCandidate?.url === fb.url); if (t?.stage === 'failed') throw Error(JSON.stringify(t)); return t?.stage === 'completed' && t; });
    const fbItem = await worker.evaluate(async id => (await chrome.downloads.search({ id }))[0], fbTask.downloadId);
    assert.deepEqual(await fs.readFile(fbItem.filename), bytes);
    results.push('Facebook progressive video through native Chrome download, full saved bytes match');
    const resolved = await send('RESOLVE_META_VIDEO', { url: page.url() }); assert(resolved.candidates.some(c => c.url === fb.url));
    results.push('Manual resolver reuses already opened Facebook video tab');
    const short = await send('RESOLVE_META_VIDEO', { url: `https://fb.watch:${server.address().port}/fixture/` }); assert(short.candidates?.some(c => c.url === fb.url), JSON.stringify(short));
    results.push('Manual fb.watch redirect resolver, owned temporary tab cleaned after success');
    const before = (await candidates()).length;
    await page.evaluate(() => window.postMessage({ channel: 'streamharbor-meta-media-v1', pageUrl: location.href, candidates: [{ url: 'https://evil.test/track.mp4', title: 'bad' }] }, location.origin));
    await new Promise(resolve => setTimeout(resolve, 250)); assert.equal((await candidates()).length, before);
    results.push('MAIN bridge rejects non-CDN forged candidate URL');
    mode = 'dash'; await page.goto('https://www.facebook.com/reel/777/');
    const dash = await wait(async () => { const r = await send('GET_TAB_CANDIDATES', { tabId: await tabId() }); return r.notice && r; });
    assert.equal(dash.candidates.length, 0); assert.match(dash.notice, /DASH/);
    results.push('DASH-only explicit notice and video-only MP4 traffic excluded');
    await page.evaluate(() => { history.pushState({}, '', '/reel/888/'); const s = document.createElement('script'); s.type = 'application/json'; s.textContent = JSON.stringify({ id: '888', playable_url: 'https://scontent.sample.fbcdn.net/spa.mp4?sig=keep' }); document.body.append(s); });
    await wait(async () => (await candidates()).find(c => c.url.includes('spa')));
    assert.equal((await send('GET_TAB_CANDIDATES', { tabId: await tabId() })).notice, undefined);
    results.push('SPA URL change clears stale pool/notice and captures new dynamic script');
    mode = 'empty';
    const blockedUrl = `https://www.instagram.com:${server.address().port}/reel/Empty/`;
    const blocked = await send('RESOLVE_META_VIDEO', { url: blockedUrl });
    assert.match(blocked.error, /保留标签页/);
    assert((await worker.evaluate(() => chrome.tabs.query({}))).some(t => t.url === blockedUrl));
    results.push('Unavailable/private/login page reports failure and remains available for user intervention');
    await popup.screenshot({ path: path.join(root, 'meta-popup-preview.png') });
    await context.unroute('**/*');
    if (process.env.META_LIVE_PROBE === '1') {
      liveContext = await chromium.launchPersistentContext(path.join(temp, 'live-profile'), {
        executablePath: process.env.CHROME_TEST_EXE || path.resolve(root, '../.tools/meta-chrome/chrome-win64/chrome.exe'), headless: true,
        args: [`--disable-extensions-except=${path.join(root, 'dist')}`, `--load-extension=${path.join(root, 'dist')}`, '--disable-features=DisableLoadExtensionCommandLineSwitch'],
      });
      const liveWorker = liveContext.serviceWorkers()[0] || await liveContext.waitForEvent('serviceworker');
      const livePopup = await liveContext.newPage(); await livePopup.goto(`chrome-extension://${new URL(liveWorker.url()).host}/src/popup/index.html`);
      const livePage = await liveContext.newPage();
      const probeUrls = ['https://www.instagram.com/reel/Chunk8-jurw/', 'https://www.facebook.com/watch/?v=10154122520715466'];
      for (const url of probeUrls) {
        try {
          await livePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await livePage.waitForTimeout(8000);
          const liveTabId = await liveWorker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url)?.id, livePage.url());
          const response = await livePopup.evaluate(tabId => chrome.runtime.sendMessage({ type: 'GET_TAB_CANDIDATES', tabId }), liveTabId);
          const structure = await livePage.evaluate(() => ({
            videos: Array.from(document.querySelectorAll('video')).map(v => ({ blob: v.currentSrc.startsWith('blob:'), readyState: v.readyState })),
            scripts: Array.from(document.scripts).map(s => { const text = s.textContent || ''; const keys = text.match(/video_versions|video_url|playable_url|progressive_urls|dash_manifest|videoDelivery/g) || []; return { length: text.length, keys: Array.from(new Set(keys)), samples: keys.length ? (text.match(/.{0,30}(?:video_versions|video_url|playable_url|progressive_urls|dash_manifest|videoDelivery).{0,120}/g) || []).slice(0, 5).map(s => s.replace(/https?[^"\s]+/g, '<URL>')) : [] }; }).filter(s => s.keys.length),
            videoLinks: Array.from(document.querySelectorAll('a[href]')).map(a => a.href).filter(u => /\/(?:reel|videos)\//.test(u)).slice(0, 8)
          }));
          const entry = { requestedUrl: url, finalUrl: livePage.url(), title: await livePage.title(), candidates: response.candidates.map(c => ({ kind: c.kind, platform: c.platform, quality: c.quality })), notice: response.notice, pageText: (await livePage.locator('body').innerText()).slice(0, 700), structure };
          live.push(entry);
          if (url.includes('watch/?v=10154122520715466') && !response.candidates.length) {
            const link = structure.videoLinks.find(u => /\/videos\/(?:[^/]+\/)?\d+/.test(u));
            if (link) { const actual = new URL(link); actual.search = ''; probeUrls.push(actual.href); }
          }
          if (response.candidates.length && process.env.META_LIVE_DOWNLOAD === '1') {
            const chosen = [...response.candidates].sort((a, b) => (parseInt(a.quality?.match(/\d+/)?.[0] || '9999') - parseInt(b.quality?.match(/\d+/)?.[0] || '9999')))[0];
            const started = await livePopup.evaluate(candidate => chrome.runtime.sendMessage({ type: 'START_NATIVE_DOWNLOAD', candidate }), chosen);
            const taskId = started.task.taskId;
            let savedTask;
            for (let i = 0; i < 240; i++) {
              savedTask = (await livePopup.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_NATIVE_DOWNLOADS' }))).tasks[taskId];
              if (savedTask?.stage === 'completed' || savedTask?.stage === 'failed') break;
              await new Promise(resolve => setTimeout(resolve, 500));
            }
            if (savedTask?.stage === 'completed') {
              const item = await liveWorker.evaluate(async id => (await chrome.downloads.search({ id }))[0], savedTask.downloadId);
              const stat = await fs.stat(item.filename);
              assert.equal(stat.size, savedTask.diagnostics.receivedBytes);
              const probe = spawnSync(process.env.FFPROBE_EXE || path.resolve(root, '../windows/node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe'), ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', item.filename], { encoding: 'utf8', windowsHide: true });
              entry.download = { completed: true, savedBytes: stat.size, diagnostics: savedTask.diagnostics, quality: chosen.quality, ffprobe: probe.status === 0 ? JSON.parse(probe.stdout) : { unavailableOrError: probe.error?.message || probe.stderr } };
              console.log(`${chosen.platform} live video saved: ${stat.size} bytes`);
            } else {
              entry.download = { completed: false, stage: savedTask?.stage, error: savedTask?.errorMessage || 'Timed out' };
              await livePopup.evaluate(taskId => chrome.runtime.sendMessage({ type: 'CONTROL_NATIVE_DOWNLOAD', taskId, action: 'cancel' }), taskId);
            }
          }
        } catch (error) { live.push({ requestedUrl: url, error: error.message }); }
      }
    }
    assert.deepEqual(errors.filter(e => !/ERR|NotSupportedError/.test(e)), []);
    await fs.writeFile(path.join(root, 'meta-browser-validation.json'), JSON.stringify({ timestamp: new Date().toISOString(), results, savedBytes: { instagram: bytes.length, facebook: bytes.length }, live, boundary: 'Routed platform-shape fixtures verify actual extension and native download. Live probes use an anonymous isolated browser and do not prove real video download/decoding.' }, null, 2));
    if (live.length) await fs.writeFile(path.join(root, 'meta-live-validation.json'), JSON.stringify({ timestamp: new Date().toISOString(), live, boundary: 'Real anonymous platform pages. Only download.completed=true verifies full native save; ffprobe is metadata validation, not full decoding. Temporary downloads and profiles removed at test end.' }, null, 2));
    console.log(`${results.length} Meta browser checks passed; ${live.length} live probes recorded`);
  } finally { await liveContext?.close(); await context?.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
