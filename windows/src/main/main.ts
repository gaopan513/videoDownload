import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, safeStorage, session, shell, utilityProcess, type MenuItemConstructorOptions, type UtilityProcess, type Session } from 'electron';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, access } from 'node:fs/promises';
import { discover, proxyConfig, abortable, fetchAt } from './resolver';
import { youtubeDlpPath } from './youtube';
import { visitMeta } from './meta';
import { cleanError, DownloadError, webUrl } from '../core/net';
import { tempDirectory } from '../core/engine';
import { run } from '../core/media';
import { applyImport, getDetail, loadSites, previewImport, saveSites, searchSite, validateSite } from './sites';
import { webSearchUrl } from './web-search';
import { SearchAdRules } from './ad-rules';
import type { Candidate, EpisodeSource, Job, SearchResult, Settings, Site, TaskView, TitleDetail } from '../shared';

if (process.env.STREAMHARBOR_TEST_DATA) app.setPath('userData', process.env.STREAMHARBOR_TEST_DATA);
let win: BrowserWindow; let settings: Settings; let file: string; let toolStatus = ''; let ffmpeg = '', ffprobe = '', ytdlp = '';
let sitesFile: string; let sites: Site[] = []; const siteSessions = new Map<string, Session>(); const detailCache = new Map<string, TitleDetail>();
let searchAdRules: SearchAdRules;
const webSearchSession = () => session.fromPartition('persist:web-search');
const episodeSources = new Map<string, EpisodeSource>(); const taskChoices = new Map<string, Candidate[]>();
let searchController: AbortController | undefined; let resolvingTaskId: string | undefined; let episodeController: AbortController | undefined;
const tasks = new Map<string, TaskView>(); const secrets = new Map<string, Candidate>(); const candidates = new Map<string, Candidate>();
const workers = new Map<string, { child: UtilityProcess; stopping?: 'paused' | 'cancelled' }>();
const refreshed = new Set<string>(); const refreshing = new Set<string>();
const reparseControllers = new Map<string, AbortController>();
const deletingRecords = new Set<string>(); const stoppedForDeletion = new Map<string, () => void>();
let resolveController: AbortController | undefined; let saving = Promise.resolve(); let quitting = false;
// Electron net 在服务器返回非法状态码（如 cdn defend 的 850、103 Early Hints）时会从 ClientRequest 事件里
// 同步抛 RangeError，不走 Promise 拒绝、fetchAt 捕获不到。吞掉该已知缺陷（挂起的 fetch 由 fetchAt 看门狗超时回收），避免主进程弹崩溃框。
process.on('uncaughtException', e => {
  if (e instanceof RangeError && e.message.includes('must be in the range of 200 to 599')) { console.error('忽略 Electron net 非法状态码异常'); return; }
  console.error(e);
});
const publicSource = (source: string) => { const u = new URL(source); return u.origin + u.pathname; };
const views = () => [...tasks.values()].reverse();
function emit() { if (win && !win.isDestroyed()) win.webContents.send('tasks', views()); }
function save() {
  saving = saving.catch(() => {}).then(async () => {
    const secure = JSON.stringify({ candidates: [...secrets], episodes: [...episodeSources], proxy: settings.proxy });
    if (!safeStorage.isEncryptionAvailable()) throw new DownloadError('STORAGE', '系统加密不可用，无法安全保存任务');
    const data = { settings: { ...settings, proxy: '' }, tasks: [...tasks.values()], secure: safeStorage.encryptString(secure).toString('base64') };
    await writeFile(file + '.new', JSON.stringify(data)); await rename(file + '.new', file);
  });
  return saving;
}
function saveBackground() { void save().catch(() => { toolStatus = '任务记录保存失败，请检查应用数据目录权限或磁盘空间'; emit(); }); }
function siteSession(id: string) { let ses = siteSessions.get(id); if (!ses) { ses = session.fromPartition('persist:site-' + id); ses.setPermissionRequestHandler((_w, _p, cb) => cb(false)); ses.setPermissionCheckHandler(() => false); siteSessions.set(id, ses); } return ses; }
async function readySiteSession(id: string) { const ses = siteSession(id); await ses.setProxy(proxyConfig(settings.proxy)); return ses; }
async function resolveEpisode(task: TaskView, episode: EpisodeSource) {
  resolvingTaskId = task.id; const controller = new AbortController(); episodeController = controller; task.state = 'resolving'; task.choices = undefined; task.message = '正在解析剧集播放入口'; emit(); saveBackground();
  try {
    const ses = await readySiteSession(episode.siteId); const found = await discover(episode.playUrl, settings.proxy, AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]), ses);
    if (['cancelled', 'paused'].includes(task.state)) return;
    const tagged = found.map(c => ({ ...c, title: task.title, episode }));
    if (tagged.length === 1) { secrets.set(task.id, tagged[0]); task.kind = tagged[0].kind; task.state = 'queued'; task.message = undefined; }
    else { taskChoices.set(task.id, tagged); task.choices = tagged.map(({ url: _u, audioUrl: _a, context: _c, episode: _e, ...publicValue }) => ({ ...publicValue, source: episode.siteName })); task.state = 'choice'; task.message = '发现多个资源，请选择清晰度和音轨'; }
  } catch (e) { if (!['cancelled', 'paused'].includes(task.state)) { task.state = 'failed'; task.message = cleanError(e); } }
  finally { resolvingTaskId = undefined; episodeController = undefined; emit(); saveBackground(); void schedule(); }
}
async function schedule() {
  if (quitting || toolStatus) return;
  for (const task of tasks.values()) {
    if (workers.size >= settings.tasks) break;
    if (task.state !== 'queued' || workers.has(task.id) || refreshing.has(task.id)) continue;
    const candidate = secrets.get(task.id);
    if (!candidate) { const episode = episodeSources.get(task.id); if (episode) { if (!resolvingTaskId) { void resolveEpisode(task, episode); } continue; } task.state = 'failed'; task.message = '任务凭据已清除，请重新解析'; continue; }
    const child = utilityProcess.fork(path.join(__dirname, 'worker.cjs'), [], { stdio: 'ignore', serviceName: 'StreamHarbor Download' });
    const record: { child: UtilityProcess; stopping?: 'paused' | 'cancelled' } = { child }; workers.set(task.id, record);
    task.state = 'downloading'; task.message = undefined;
    const job: Job = { id: task.id, candidate, directory: task.directory, concurrency: settings.concurrency, proxy: settings.proxy, mode: task.mode, deep: task.deep, ffmpeg, ffprobe, ytdlp };
    child.on('spawn', () => child.postMessage({ type: 'start', job }));
    let ended = false;
    const finish = async () => {
      if (ended) return; ended = true; workers.delete(task.id); child.kill(); task.speed = 0;
      if (record.stopping) {
        task.state = record.stopping;
        if (record.stopping === 'cancelled') { secrets.delete(task.id); episodeSources.delete(task.id); await rm(tempDirectory(task), { recursive: true, force: true }).catch(() => { task.message = '已取消，但临时文件清理失败，可稍后点击清理'; }); }
      }
      emit(); saveBackground(); stoppedForDeletion.get(task.id)?.(); stoppedForDeletion.delete(task.id); void schedule();
    };
    child.on('message', async (m: any) => {
      if (m.type === 'proxy') { try { const pac = await session.defaultSession.resolveProxy(webUrl(m.url).href); const first = pac.split(';')[0].trim(); const [type, address] = first.split(/\s+/); child.postMessage({ type: 'proxy-result', id: m.id, value: type === 'DIRECT' ? '' : `${type === 'SOCKS5' || type === 'SOCKS' ? 'socks5h' : type === 'HTTPS' ? 'https' : 'http'}://${address}` }); } catch { child.postMessage({ type: 'proxy-result', id: m.id, value: '' }); } return; }
      if (ended) return;
      if (m.type === 'progress') { task.done = m.done; task.total = m.total; task.speed = m.speed; emit(); }
      if (m.type === 'stage' && !record.stopping) { task.state = m.state; task.message = m.message; emit(); }
      if (m.type === 'complete') { if (!deletingRecords.has(task.id)) record.stopping = undefined; task.state = 'complete'; task.output = m.output; task.message = '已完成媒体校验'; secrets.delete(task.id); episodeSources.delete(task.id); await finish(); }
      if (m.type === 'error') {
        if (process.env.STREAMHARBOR_TEST_DATA && m.diagnostic) console.error(m.diagnostic);
        if (m.code === 'AUTH' && !refreshed.has(task.id) && !record.stopping) {
          const controller = new AbortController(); reparseControllers.set(task.id, controller);
          refreshed.add(task.id); refreshing.add(task.id); task.state = 'paused'; task.message = '地址失效，正在重新解析原网页'; await finish();
          try {
            const found = await discover(candidate.source, settings.proxy, AbortSignal.any([controller.signal, AbortSignal.timeout(50000)]), candidate.episode ? await readySiteSession(candidate.episode.siteId) : undefined);
            if (controller.signal.aborted || tasks.get(task.id) !== task) return;
            const same = found.find(c => c.kind === candidate.kind && c.quality === candidate.quality && c.audioName === candidate.audioName && c.url === candidate.url && c.audioUrl === candidate.audioUrl);
            if (!same) throw new DownloadError('CHANGED', '新地址无法证明与旧内容一致；已保留数据，请选择重新下载');
            if ((task.state as string) !== 'cancelled') { secrets.set(task.id, { ...same, episode: candidate.episode, title: candidate.title }); task.state = 'queued'; }
          } catch (e) { if (!controller.signal.aborted && tasks.get(task.id) === task && (task.state as string) !== 'cancelled') { task.state = 'failed'; task.message = cleanError(e); } }
          finally { reparseControllers.delete(task.id); refreshing.delete(task.id); emit(); saveBackground(); void schedule(); }
          return;
        }
        task.state = m.code === 'CONFIRM' ? 'confirm' : 'failed'; task.message = m.message; await finish();
      }
    });
    child.on('exit', () => { if (!ended) { task.state = 'failed'; task.message = '下载进程意外退出，已保留恢复数据'; void finish(); } });
  }
  emit(); saveBackground();
}
function handle(name: string, fn: (...args: any[]) => any) {
  ipcMain.handle(name, async (event, ...args) => { if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Access denied'); try { return await fn(...args); } catch (e) { throw new Error(cleanError(e)); } });
}
async function openWebSearchWindow(engine: 'google' | 'duckduckgo', query: string) {
  const url = webSearchUrl(engine, query);
  const name = engine === 'google' ? 'Google 搜索' : 'DuckDuckGo 搜索';
  await searchAdRules.start();
  const searchSession = webSearchSession();
  await searchSession.setProxy(proxyConfig(settings.proxy));
  const browser = new BrowserWindow({ width: 1100, height: 820, title: name, webPreferences: { session: searchSession, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const copyCurrentUrl = () => { const current = browser.webContents.getURL(); clipboard.writeText(/^https?:\/\//.test(current) ? current : url); };
  browser.setMenu(Menu.buildFromTemplate([{ label: '网页', submenu: [
    { label: '复制当前页面网址', accelerator: 'CommandOrControl+L', click: copyCurrentUrl },
    { label: '后退', accelerator: 'Alt+Left', click: () => { if (browser.webContents.navigationHistory.canGoBack()) browser.webContents.navigationHistory.goBack(); } },
    { label: '前进', accelerator: 'Alt+Right', click: () => { if (browser.webContents.navigationHistory.canGoForward()) browser.webContents.navigationHistory.goForward(); } },
    { label: '刷新', accelerator: 'CommandOrControl+R', click: () => browser.webContents.reload() }
  ] }]));
  browser.webContents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = [{ label: '复制当前页面网址', click: copyCurrentUrl }];
    if (params.linkURL) items.push({ label: '复制链接地址', click: () => clipboard.writeText(params.linkURL) });
    Menu.buildFromTemplate(items).popup({ window: browser });
  });
  browser.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && input.key.toLowerCase() === 'l') { event.preventDefault(); copyCurrentUrl(); }
  });
  browser.webContents.setWindowOpenHandler(({ url: target }) => { try { void browser.loadURL(webUrl(target).href).catch(() => {}); } catch {} return { action: 'deny' }; });
  void browser.loadURL(url).catch(() => {});
  return searchAdRules.loaded;
}
app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock() && !process.env.STREAMHARBOR_TEST_DATA) { app.quit(); return; }
  file = path.join(app.getPath('userData'), 'state.json'); await mkdir(path.dirname(file), { recursive: true });
  sitesFile = path.join(app.getPath('userData'), 'sites.json');
  try { sites = await loadSites(sitesFile); } catch (e) { toolStatus = cleanError(e); }
  settings = { directory: app.getPath('downloads'), tasks: 2, concurrency: 8, proxy: '', deep: false };
  try {
    const saved = JSON.parse(await readFile(file, 'utf8')); settings = { ...settings, ...saved.settings };
    for (const task of saved.tasks || []) { if (!['complete', 'failed', 'cancelled', 'paused'].includes(task.state)) task.state = 'paused'; task.speed = 0; tasks.set(task.id, task); }
    const secure = JSON.parse(safeStorage.decryptString(Buffer.from(saved.secure, 'base64'))); settings.proxy = secure.proxy || ''; for (const [id, candidate] of secure.candidates) secrets.set(id, candidate); for (const [id, episode] of secure.episodes || []) episodeSources.set(id, episode);
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') toolStatus = '任务记录无法读取或解密，请检查本机账户及数据文件'; }
  await session.defaultSession.setProxy(proxyConfig(settings.proxy));
  searchAdRules = new SearchAdRules(path.join(app.getPath('userData'), 'ad-rules.txt'), session.defaultSession, webSearchSession(), process.env.STREAMHARBOR_TEST_DATA && process.env.STREAMHARBOR_TEST_AD_RULES_URL || undefined);
  void searchAdRules.start();
  ffmpeg = app.isPackaged ? path.join(process.resourcesPath, 'bin/ffmpeg.exe') : path.join(app.getAppPath(), 'node_modules/ffmpeg-static/ffmpeg.exe');
  ffprobe = app.isPackaged ? path.join(process.resourcesPath, 'bin/ffprobe.exe') : path.join(app.getAppPath(), 'node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
  ytdlp = youtubeDlpPath();
  try { await run(ffprobe, ['-version'], AbortSignal.timeout(10000)); const codecs = await run(ffmpeg, ['-hide_banner', '-encoders'], AbortSignal.timeout(10000)); if (!codecs.includes('libx264') || !codecs.includes('aac')) throw new Error(); } catch { toolStatus = 'FFmpeg/FFprobe 不可用或缺少编码器，请重新安装应用'; }
  app.setAppUserModelId('local.streamharbor.desktop');
  const icon = app.isPackaged ? path.join(process.resourcesPath, 'icons/spiderweb.ico') : path.join(app.getAppPath(), 'build/spiderweb.ico');
  win = new BrowserWindow({ width: 1180, height: 820, minWidth: 860, minHeight: 640, backgroundColor: '#eef3f8', title: 'StreamHarbor', icon, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.removeMenu(); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', e => e.preventDefault());
  handle('init', () => ({ settings, tasks: views(), tools: toolStatus }));
  handle('visit-meta', (url: string) => visitMeta(url, settings.proxy));
  handle('sites', () => sites);
  handle('save-sites', async (values: Site[]) => { if (!Array.isArray(values) || values.length > 200) throw new DownloadError('SITE', '站点数量无效'); const next = values.map(validateSite); await saveSites(sitesFile, next); sites = next; });
  handle('preview-sites', (raw: string) => previewImport(raw, sites));
  handle('import-sites', async (raw: string, replace: number[]) => { const next = applyImport(sites, previewImport(raw, sites), Array.isArray(replace) ? replace : []); await saveSites(sitesFile, next); sites = next; return sites; });
  handle('export-sites', async () => { const result = await dialog.showSaveDialog(win, { defaultPath: 'streamharbor-sites.json', filters: [{ name: 'JSON', extensions: ['json'] }] }); if (result.canceled || !result.filePath) return undefined; await writeFile(result.filePath, JSON.stringify({ version: 1, sites }, null, 2)); return result.filePath; });
  handle('open-web-search', (engine: 'google' | 'duckduckgo', query: string) => openWebSearchWindow(engine, query));
  handle('search', (query: string, ids: string[], page = 1, only?: string, requestedId?: string) => {
    if (typeof query !== 'string' || !query.trim() || query.length > 120 || !Array.isArray(ids) || !Number.isInteger(page) || page < 1 || page > 100) throw new DownloadError('SEARCH', '搜索参数无效');
    searchController?.abort(); const controller = new AbortController(); searchController = controller; const requestId = typeof requestedId === 'string' && /^[a-f0-9-]{36}$/.test(requestedId) ? requestedId : randomUUID();
    const chosen = sites.filter(s => s.enabled && s.adapter !== 'none' && ids.includes(s.id) && (!only || only === s.id));
    void (async () => { let cursor = 0; await Promise.all(Array.from({ length: Math.min(3, chosen.length) }, async () => { while (cursor < chosen.length && !controller.signal.aborted) { const site = chosen[cursor++]; const timeout = AbortSignal.timeout(30000); const signal = AbortSignal.any([controller.signal, timeout]); try { const result = await searchSite(site, await readySiteSession(site.id), query.trim(), page, signal); if (!controller.signal.aborted) win.webContents.send('search-result', { requestId, siteId: site.id, page, result }); } catch (e) { if (!controller.signal.aborted) win.webContents.send('search-result', { requestId, siteId: site.id, page, error: timeout.aborted ? '搜索超时' : cleanError(e) }); } } })); if (searchController === controller) searchController = undefined; })();
    return requestId;
  });
  handle('cancel-search', () => searchController?.abort());
  handle('cover', async (siteId: string, url: string) => {
    const site = sites.find(s => s.id === siteId && s.enabled);
    if (!site || typeof url !== 'string' || url.length > 2048) throw new DownloadError('COVER', '封面地址无效');
    webUrl(url);
    const response = await fetchAt(await readySiteSession(siteId), url, { signal: AbortSignal.timeout(12000), headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*', referer: site.url } });
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!response.ok || !['image/avif', 'image/webp', 'image/png', 'image/jpeg', 'image/gif'].includes(type)) throw new DownloadError('COVER', '封面无法读取');
    const reader = response.body?.getReader(); if (!reader) throw new DownloadError('COVER', '封面为空');
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 1024 * 1024) throw new DownloadError('COVER', '封面过大'); chunks.push(part.value); } }
    finally { void reader.cancel().catch(() => {}); }
    return `data:${type};base64,${Buffer.concat(chunks).toString('base64')}`;
  });
  handle('detail', async (result: SearchResult) => { const site = sites.find(s => s.id === result?.siteId && s.enabled); if (!site || site.adapter === 'none') throw new DownloadError('SITE', '站点已停用或未适配'); const detail = await getDetail(site, await readySiteSession(site.id), result, AbortSignal.timeout(30000)); detailCache.set(detail.url, detail); while (detailCache.size > 100) detailCache.delete(detailCache.keys().next().value!); return detail; });
  handle('visit-site', async (id: string) => { const site = sites.find(s => s.id === id); if (!site) throw new DownloadError('SITE', '站点不存在'); const browser = new BrowserWindow({ width: 1100, height: 820, title: site.name, webPreferences: { session: await readySiteSession(id), sandbox: true, contextIsolation: true, nodeIntegration: false } }); browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); await browser.loadURL(site.url); });
  handle('clear-site-login', async (id: string) => { if (!sites.some(s => s.id === id)) throw new DownloadError('SITE', '站点不存在'); await siteSession(id).clearStorageData(); });
  handle('batch', async (request: TitleDetail, lineId: string, episodeIds: string[], directory: string, batchId: string) => {
    const detail = detailCache.get(request?.url); const line = detail?.lines.find(l => l.id === lineId); const site = sites.find(s => s.id === detail?.siteId); if (!detail || !line || !site || !Array.isArray(episodeIds) || episodeIds.length > 500 || !/^[a-zA-Z0-9-]{1,100}$/.test(batchId || '') || typeof directory !== 'string' || !path.isAbsolute(directory)) throw new DownloadError('BATCH', '批量任务参数无效，请重新打开详情');
    await mkdir(directory, { recursive: true }); const test = path.join(directory, `.harbor-write-${randomUUID()}`); await writeFile(test, ''); await rm(test);
    const created: string[] = []; for (const ep of line.episodes.filter(e => episodeIds.includes(e.id))) { const batchKey = createHash('sha256').update(batchId).update('\0').update(ep.url).digest('hex'); if (views().some(t => t.batchKey === batchKey)) continue; const id = randomUUID(); const source: EpisodeSource = { siteId: site.id, siteName: site.name, title: detail.title, line: line.name, episode: ep.name, playUrl: ep.url, batchId }; episodeSources.set(id, source); tasks.set(id, { id, title: `${detail.title} · ${ep.name}`, source: site.name, kind: '待解析', state: 'queued', done: 0, total: 0, speed: 0, directory, mode: 'mp4', deep: settings.deep, batchKey }); created.push(id); }
    try { await save(); } catch (e) { for (const id of created) { tasks.delete(id); episodeSources.delete(id); } emit(); throw e; }
    emit(); void schedule(); return created.length;
  });
  handle('choose-candidate', async (taskId: string, candidateId: string) => { const task = tasks.get(taskId); const candidate = taskChoices.get(taskId)?.find(c => c.id === candidateId); if (!task || task.state !== 'choice' || !candidate) throw new DownloadError('CANDIDATE', '候选资源已失效，请重新解析'); secrets.set(taskId, candidate); taskChoices.delete(taskId); task.choices = undefined; task.kind = candidate.kind; task.state = 'queued'; task.message = undefined; await save(); emit(); void schedule(); });
  handle('resolve', async (url: string) => {
    if (typeof url !== 'string' || url.length > 8192) throw new DownloadError('URL', '网址过长或无效');
    if (resolveController) throw new DownloadError('BUSY', '正在解析其他网址');
    resolveController = new AbortController(); const timer = setTimeout(() => resolveController?.abort(), 90000);
    try { const result = await abortable(discover(url, settings.proxy, resolveController.signal), resolveController.signal); for (const c of result) candidates.set(c.id, c); while (candidates.size > 500) candidates.delete(candidates.keys().next().value!); return result.map(({ url: _, audioUrl: _a, context: _c, ...c }) => ({ ...c, source: publicSource(c.source) })); }
    finally { clearTimeout(timer); resolveController = undefined; }
  });
  handle('cancel-resolve', () => resolveController?.abort());
  handle('choose-directory', async () => (await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: settings.directory })).filePaths[0]);
  handle('settings', async (value: Settings) => {
    if (!value || !Number.isInteger(value.tasks) || value.tasks < 1 || value.tasks > 4 || !Number.isInteger(value.concurrency) || value.concurrency < 1 || value.concurrency > 16 || typeof value.directory !== 'string' || !path.isAbsolute(value.directory) || typeof value.proxy !== 'string' || typeof value.deep !== 'boolean') throw new DownloadError('SETTINGS', '设置参数无效');
    if (workers.size || resolveController || reparseControllers.size) throw new DownloadError('BUSY', '请等待解析完成并暂停下载后再修改设置');
    if (value.proxy) { const u = new URL(value.proxy); if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(u.protocol)) throw new DownloadError('PROXY', '代理需使用 HTTP、HTTPS 或 SOCKS5 协议'); if (u.protocol.startsWith('socks') && (u.username || u.password)) throw new DownloadError('PROXY', '后台浏览器不支持带账号密码的 SOCKS5，请使用无认证 SOCKS5 或 HTTP 代理'); }
    settings = { directory: value.directory, tasks: value.tasks, concurrency: value.concurrency, proxy: value.proxy, deep: value.deep }; await session.defaultSession.setProxy(proxyConfig(settings.proxy)); await save(); void schedule();
  });
  handle('add', async (id: string, directory: string) => {
    const c = candidates.get(id); if (!c) throw new DownloadError('CANDIDATE', '候选资源已失效，请重新解析');
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new DownloadError('PATH', '请选择有效的下载目录');
    await mkdir(directory, { recursive: true }); const test = path.join(directory, `.harbor-write-${randomUUID()}`); await writeFile(test, ''); await rm(test);
    const taskId = randomUUID(); secrets.set(taskId, c); tasks.set(taskId, { id: taskId, title: c.title, source: publicSource(c.source), kind: c.kind, state: 'queued', done: 0, total: 0, speed: 0, directory, mode: 'mp4', deep: settings.deep }); await save(); void schedule();
  });
  handle('control', async (id: string, action: string) => {
    const task = tasks.get(id); if (!task || !['pause', 'resume', 'cancel', 'retry', 'restart', 'mkv', 'transcode', 'clean'].includes(action)) throw new DownloadError('TASK', '任务操作无效');
    if (deletingRecords.has(id)) throw new DownloadError('BUSY', '记录正在删除');
    const record = workers.get(id);
    if (action === 'pause' || action === 'cancel') {
      if (task.state === 'complete') return;
      reparseControllers.get(id)?.abort();
      if (resolvingTaskId === id) episodeController?.abort();
      if (record) { record.stopping = action === 'pause' ? 'paused' : 'cancelled'; record.child.postMessage({ type: 'abort' }); task.message = '正在停止并保存状态'; }
      else { task.state = action === 'pause' ? 'paused' : 'cancelled'; if (action === 'cancel') { secrets.delete(id); episodeSources.delete(id); taskChoices.delete(id); task.choices = undefined; await rm(tempDirectory(task), { recursive: true, force: true }); } }
    } else if (action === 'clean') {
      if (record || refreshing.has(id)) throw new DownloadError('BUSY', '请先停止任务'); await rm(tempDirectory(task), { recursive: true, force: true }); task.message = '临时文件已清理';
    } else {
      if (record || refreshing.has(id) || ['complete', 'cancelled'].includes(task.state)) return;
      if (action === 'restart') {
        const c = secrets.get(id); if (!c && episodeSources.has(id)) { taskChoices.delete(id); task.choices = undefined; task.state = 'queued'; await save(); emit(); void schedule(); return; } if (!c) throw new DownloadError('TASK', '请重新解析地址');
        const controller = new AbortController(); reparseControllers.set(id, controller); refreshing.add(id);
        task.state = 'resolving'; task.message = '正在重新解析原网页'; emit(); saveBackground();
        try {
          const fresh = await discover(c.source, settings.proxy, AbortSignal.any([controller.signal, AbortSignal.timeout(55000)]), c.episode ? await readySiteSession(c.episode.siteId) : undefined);
          if (controller.signal.aborted || tasks.get(id) !== task) return;
          const replacement = fresh.find(x => x.kind === c.kind && x.quality === c.quality && x.audioName === c.audioName);
          if (!replacement) throw new DownloadError('CHANGED', '原清晰度或音轨不再存在，请重新解析选择');
          await rm(tempDirectory(task), { recursive: true, force: true });
          if (controller.signal.aborted || tasks.get(id) !== task) return;
          secrets.set(id, { ...replacement, episode: c.episode, title: c.title }); task.done = 0; task.total = 0;
          refreshed.delete(id); task.state = 'queued'; task.message = undefined;
          await save();
        } catch (e) {
          if (!controller.signal.aborted && tasks.get(id) === task) { task.state = 'failed'; task.message = cleanError(e); throw e; }
        } finally { reparseControllers.delete(id); refreshing.delete(id); emit(); saveBackground(); void schedule(); }
        return;
      }
      if (action === 'mkv' || action === 'transcode') task.mode = action;
      refreshed.delete(id); task.state = 'queued'; task.message = undefined;
    }
    await save(); emit(); void schedule();
  });
  handle('open-output', async (id: string) => { const task = tasks.get(id); if (task?.output) { await access(task.output); shell.showItemInFolder(task.output); } });
  handle('delete-record', async (id: string) => {
    const task = tasks.get(id); if (!task || deletingRecords.has(id)) throw new DownloadError('TASK', '任务记录不存在或正在删除');
    deletingRecords.add(id);
    try {
      reparseControllers.get(id)?.abort();
      if (resolvingTaskId === id) { task.state = 'cancelled'; episodeController?.abort(); }
      if (refreshing.has(id)) task.state = 'cancelled';
      const record = workers.get(id);
      if (record) await new Promise<void>(resolve => {
        stoppedForDeletion.set(id, resolve); record.stopping = 'cancelled'; task.message = '正在停止并删除记录'; emit();
        try { record.child.postMessage({ type: 'abort' }); } catch { record.child.kill(); }
        setTimeout(() => { if (workers.has(id)) record.child.kill(); }, 5000);
      });
      const secret = secrets.get(id), episode = episodeSources.get(id), choices = taskChoices.get(id), wasRefreshed = refreshed.has(id);
      tasks.delete(id); secrets.delete(id); episodeSources.delete(id); taskChoices.delete(id); refreshed.delete(id);
      try { await save(); }
      catch (e) {
        tasks.set(id, task); if (secret) secrets.set(id, secret); if (episode) episodeSources.set(id, episode);
        if (choices) taskChoices.set(id, choices); if (wasRefreshed) refreshed.add(id); emit(); throw e;
      }
      emit();
      const cleanupFailed = /^[a-f0-9-]{36}$/.test(id) ? await rm(tempDirectory(task), { recursive: true, force: true }).then(() => false, () => true) : false;
      return { cleanupFailed };
    } finally { deletingRecords.delete(id); stoppedForDeletion.delete(id); }
  });
  handle('clear-completed', async () => {
    const completed = views().filter(task => task.state === 'complete' && !workers.has(task.id));
    const removed = completed.map(task => ({ task, secret: secrets.get(task.id), episode: episodeSources.get(task.id), choices: taskChoices.get(task.id), wasRefreshed: refreshed.has(task.id) }));
    for (const { task } of removed) { tasks.delete(task.id); secrets.delete(task.id); episodeSources.delete(task.id); taskChoices.delete(task.id); refreshed.delete(task.id); }
    try { await save(); }
    catch (e) { for (const { task, secret, episode, choices, wasRefreshed } of removed) { tasks.set(task.id, task); if (secret) secrets.set(task.id, secret); if (episode) episodeSources.set(task.id, episode); if (choices) taskChoices.set(task.id, choices); if (wasRefreshed) refreshed.add(task.id); } emit(); throw e; }
    emit();
    return completed.length;
  });
  await win.loadFile(path.join(__dirname, '../ui/index.html'));
});
app.on('second-instance', () => { win?.show(); win?.focus(); });
app.on('login', (event, _webContents, _details, authInfo, callback) => { event.preventDefault(); if (authInfo.isProxy && settings?.proxy) { const u = new URL(settings.proxy); if (u.username) { callback(decodeURIComponent(u.username), decodeURIComponent(u.password)); return; } } callback(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', e => {
  if (quitting) return; e.preventDefault(); quitting = true; resolveController?.abort(); searchController?.abort(); episodeController?.abort();
  for (const [id, controller] of reparseControllers) { controller.abort(); const task = tasks.get(id); if (task && !['complete', 'cancelled'].includes(task.state)) task.state = 'paused'; }
  for (const [id, record] of workers) { record.stopping = 'paused'; record.child.postMessage({ type: 'abort' }); tasks.get(id)!.state = 'paused'; }
  setTimeout(() => { for (const r of workers.values()) r.child.kill(); void save().finally(() => app.quit()); }, workers.size ? 1500 : 0);
});
