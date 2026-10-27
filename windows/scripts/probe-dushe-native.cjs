const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { searchSite, getDetail, discover, download } = require('../dist/tests/site-runtime.cjs');
const { createHash, randomUUID } = require('node:crypto');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamharbor-dushe-native-'));
app.setPath('userData', dataDir);
const result = {};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function snapshot(win) {
  return win.webContents.executeJavaScript(`(() => ({ url: location.href, title: document.title, text: document.body?.innerText.slice(0, 600), forms: [...document.forms].map(f => ({ action: f.action, method: f.method, fields: [...f.querySelectorAll('input')].map(i => ({ name: i.name, value: i.value, type: i.type })) })), links: [...document.querySelectorAll('a[href]')].filter(a => /仙逆|detail|vod|play/i.test(a.href + a.textContent)).slice(0, 30).map(a => ({ text: a.textContent?.trim().slice(0, 50), href: a.href, className: a.className })) }))()`, true);
}
app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:site-dushe');
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  const win = new BrowserWindow({ show: false, width: 1100, height: 820, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await Promise.race([win.loadURL('https://dushe3.app/'), pause(20000).then(() => { throw new Error('home timeout'); })]);
    await pause(2000); result.home = await snapshot(win);
    const form = result.home.forms?.find(f => f.action.includes('/search'));
    if (form && !/baidu|verify|captcha/i.test(result.home.title)) {
      const url = new URL(form.action); url.searchParams.set('k', '仙逆'); for (const field of form.fields) if (field.name && field.name !== 'k') url.searchParams.set(field.name, field.value);
      await Promise.race([win.loadURL(url.href), pause(20000).then(() => { throw new Error('search timeout'); })]);
      await pause(2000); result.search = await snapshot(win);
      result.searchDom = await win.webContents.executeJavaScript(`(() => ({ cards: [...document.querySelectorAll('a.search-result-item')].slice(0, 3).map(a => a.outerHTML.slice(0, 1200)), pages: [...document.querySelectorAll('a[href]')].filter(a => a.href.includes('search') || a.href.includes('page') || a.textContent?.includes('下一页')).slice(-20).map(a => ({ text: a.textContent?.trim().slice(0, 30), href: a.href, className: a.className })) }))()`, true);
      const first = result.search.links?.find(link => /\/detail\//.test(link.href));
      if (first) {
        await Promise.race([win.loadURL(first.href), pause(20000).then(() => { throw new Error('detail timeout'); })]);
        await pause(2000); result.detail = await snapshot(win);
        result.detailDom = await win.webContents.executeJavaScript(`(() => ({ headings: [...document.querySelectorAll('h1,h2,h3')].slice(0, 20).map(x => ({ text: x.textContent?.trim(), className: x.className })), playLinks: [...document.querySelectorAll('a[href]')].filter(a => /play|episode/i.test(a.href)).slice(0, 35).map(a => ({ text: a.textContent?.trim().slice(0, 50), href: a.href, className: a.className })), playNodes: [...document.querySelectorAll('[class*=play],[id*=play]')].slice(0, 18).map(x => ({ tag: x.tagName, className: x.className, id: x.id, text: x.textContent?.trim().slice(0, 70) })), playBox: document.querySelector('.detail-play-box')?.outerHTML.slice(0, 6500), episodeSample: document.querySelector('a.episode-item')?.parentElement?.parentElement?.outerHTML.slice(0, 2600), sourceCount: document.querySelectorAll('.source-item').length, episodeCount: document.querySelectorAll('a.episode-item').length, lineSummary: [...document.querySelectorAll('.episode-list')].slice(0, 25).map((list, i) => ({ i, count: list.querySelectorAll('a.episode-item').length, first: list.querySelector('a.episode-item')?.getAttribute('href'), className: list.className, style: list.getAttribute('style') })) }))()`, true);
      }
      try {
        const site = { id: 'dushe', name: '毒舌', url: 'https://dushe3.app/', adapter: 'dushe', enabled: true };
        const page = await searchSite(site, ses, '仙逆', 1, AbortSignal.timeout(30000));
        result.adapterSearch = { count: page.items.length, hasMore: page.hasMore, first: page.items[0] };
        const page2 = await searchSite(site, ses, '仙逆', 2, AbortSignal.timeout(30000));
        result.adapterPage2 = { count: page2.items.length, firstId: page2.items[0]?.id, distinct: page2.items[0]?.id !== page.items[0]?.id };
        if (page.items[0]) {
          const detail = await getDetail(site, ses, page.items[0], AbortSignal.timeout(30000)); result.adapterDetail = { title: detail.title, lines: detail.lines.length, counts: detail.lines.map(line => line.episodes.length), firstPlayUrl: detail.lines[0]?.episodes[0]?.url };
          if (process.argv.includes('--media-probe') || process.argv.includes('--full-download')) {
            const line = detail.lines[0]; const episode = line.episodes[0];
            result.mediaSource = { line: line.name, episode: episode.name, playUrl: episode.url };
            const candidates = await discover(episode.url, '', AbortSignal.timeout(60000), ses);
            result.mediaCandidates = candidates.map(c => ({ kind: c.kind, quality: c.quality, host: new URL(c.url).hostname }));
            if (process.argv.includes('--full-download') && candidates.length) {
              const directory = path.join(dataDir, 'downloads'); fs.mkdirSync(directory, { recursive: true });
              const candidate = { ...candidates[0], title: `${detail.title} · ${episode.name}` };
              const job = { id: randomUUID(), candidate, directory, concurrency: 8, proxy: '', mode: 'mp4', deep: true, ffmpeg: path.join(__dirname, '../node_modules/ffmpeg-static/ffmpeg.exe'), ffprobe: path.join(__dirname, '../node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe') };
              const progress = []; const output = await download(job, AbortSignal.timeout(240000), event => { if (event.type === 'stage') progress.push(event.state); });
              const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(output)) hash.update(chunk);
              result.fullDownload = { state: 'complete', bytes: fs.statSync(output).size, sha256: hash.digest('hex'), stages: progress };
            }
          }
        }
      } catch (error) { result.adapterError = String(error.message || error); }
    }
  } catch (error) { result.error = String(error.message || error); }
  finally {
    fs.mkdirSync('artifacts', { recursive: true }); fs.writeFileSync('artifacts/dushe-native-probe.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
    win.destroy(); app.quit();
  }
});
app.on('window-all-closed', () => {});
app.on('quit', () => { if (path.resolve(dataDir).startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(dataDir, { recursive: true, force: true }); });
