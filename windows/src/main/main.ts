import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell, utilityProcess, type UtilityProcess } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, access } from 'node:fs/promises';
import { discover, proxyConfig, abortable } from './resolver';
import { cleanError, DownloadError, webUrl } from '../core/net';
import { tempDirectory } from '../core/engine';
import { run } from '../core/media';
import type { Candidate, Job, Settings, TaskView } from '../shared';

if (process.env.STREAMHARBOR_TEST_DATA) app.setPath('userData', process.env.STREAMHARBOR_TEST_DATA);
let win: BrowserWindow; let settings: Settings; let file: string; let toolStatus = ''; let ffmpeg = '', ffprobe = '';
const tasks = new Map<string, TaskView>(); const secrets = new Map<string, Candidate>(); const candidates = new Map<string, Candidate>();
const workers = new Map<string, { child: UtilityProcess; stopping?: 'paused' | 'cancelled' }>();
const refreshed = new Set<string>(); const refreshing = new Set<string>();
let resolveController: AbortController | undefined; let saving = Promise.resolve(); let quitting = false;
// Electron net 在服务器返回非法状态码（如 cdn defend 的 850、103 Early Hints）时会从 ClientRequest 事件里
// 同步抛 RangeError，不走 Promise 拒绝、fetchAt 捕获不到。吞掉该已知缺陷（挂起的 fetch 由 fetchAt 看门狗超时回收），避免主进程弹崩溃框。
process.on('uncaughtException', e => {
  if (e instanceof RangeError && e.message.includes('must be in the range of 200 to 599')) { console.error('忽略 Electron net 非法状态码异常'); return; }
  console.error(e);
});
const publicSource = (source: string) => { const u = new URL(source); return u.origin + u.pathname; };
const views = () => [...tasks.values()];
function emit() { if (win && !win.isDestroyed()) win.webContents.send('tasks', views()); }
function save() {
  saving = saving.catch(() => {}).then(async () => {
    const secure = JSON.stringify({ candidates: [...secrets], proxy: settings.proxy });
    if (!safeStorage.isEncryptionAvailable()) throw new DownloadError('STORAGE', '系统加密不可用，无法安全保存任务');
    const data = { settings: { ...settings, proxy: '' }, tasks: views(), secure: safeStorage.encryptString(secure).toString('base64') };
    await writeFile(file + '.new', JSON.stringify(data)); await rename(file + '.new', file);
  });
  return saving;
}
function saveBackground() { void save().catch(() => { toolStatus = '任务记录保存失败，请检查应用数据目录权限或磁盘空间'; emit(); }); }
async function schedule() {
  if (quitting || toolStatus) return;
  for (const task of tasks.values()) {
    if (workers.size >= settings.tasks) break;
    if (task.state !== 'queued' || workers.has(task.id) || refreshing.has(task.id)) continue;
    const candidate = secrets.get(task.id); if (!candidate) { task.state = 'failed'; task.message = '任务凭据已清除，请重新解析'; continue; }
    const child = utilityProcess.fork(path.join(__dirname, 'worker.cjs'), [], { stdio: 'ignore', serviceName: 'StreamHarbor Download' });
    const record: { child: UtilityProcess; stopping?: 'paused' | 'cancelled' } = { child }; workers.set(task.id, record);
    task.state = 'downloading'; task.message = undefined;
    const job: Job = { id: task.id, candidate, directory: task.directory, concurrency: settings.concurrency, proxy: settings.proxy, mode: task.mode, deep: task.deep, ffmpeg, ffprobe };
    child.on('spawn', () => child.postMessage({ type: 'start', job }));
    let ended = false;
    const finish = async () => {
      if (ended) return; ended = true; workers.delete(task.id); child.kill(); task.speed = 0;
      if (record.stopping) {
        task.state = record.stopping;
        if (record.stopping === 'cancelled') { secrets.delete(task.id); await rm(tempDirectory(task), { recursive: true, force: true }).catch(() => { task.message = '已取消，但临时文件清理失败，可稍后点击清理'; }); }
      }
      emit(); saveBackground(); void schedule();
    };
    child.on('message', async (m: any) => {
      if (m.type === 'proxy') { try { const pac = await session.defaultSession.resolveProxy(webUrl(m.url).href); const first = pac.split(';')[0].trim(); const [type, address] = first.split(/\s+/); child.postMessage({ type: 'proxy-result', id: m.id, value: type === 'DIRECT' ? '' : `${type === 'SOCKS5' || type === 'SOCKS' ? 'socks5h' : type === 'HTTPS' ? 'https' : 'http'}://${address}` }); } catch { child.postMessage({ type: 'proxy-result', id: m.id, value: '' }); } return; }
      if (ended) return;
      if (m.type === 'progress') { task.done = m.done; task.total = m.total; task.speed = m.speed; emit(); }
      if (m.type === 'stage' && !record.stopping) { task.state = m.state; task.message = m.message; emit(); }
      if (m.type === 'complete') { record.stopping = undefined; task.state = 'complete'; task.output = m.output; task.message = '已完成媒体校验'; secrets.delete(task.id); await finish(); }
      if (m.type === 'error') {
        if (process.env.STREAMHARBOR_TEST_DATA && m.diagnostic) console.error(m.diagnostic);
        if (m.code === 'AUTH' && !refreshed.has(task.id) && !record.stopping) {
          refreshed.add(task.id); refreshing.add(task.id); task.state = 'paused'; task.message = '地址失效，正在重新解析原网页'; await finish();
          try {
            const found = await discover(candidate.source, settings.proxy, AbortSignal.timeout(50000));
            const same = found.find(c => c.kind === candidate.kind && c.quality === candidate.quality && c.audioName === candidate.audioName && c.url === candidate.url && c.audioUrl === candidate.audioUrl);
            if (!same) throw new DownloadError('CHANGED', '新地址无法证明与旧内容一致；已保留数据，请选择重新下载');
            if ((task.state as string) !== 'cancelled') { secrets.set(task.id, same); task.state = 'queued'; }
          } catch (e) { if ((task.state as string) !== 'cancelled') { task.state = 'failed'; task.message = cleanError(e); } }
          finally { refreshing.delete(task.id); emit(); saveBackground(); void schedule(); }
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
app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock() && !process.env.STREAMHARBOR_TEST_DATA) { app.quit(); return; }
  file = path.join(app.getPath('userData'), 'state.json'); await mkdir(path.dirname(file), { recursive: true });
  settings = { directory: app.getPath('downloads'), tasks: 2, concurrency: 8, proxy: '', deep: false };
  try {
    const saved = JSON.parse(await readFile(file, 'utf8')); settings = { ...settings, ...saved.settings };
    for (const task of saved.tasks || []) { if (!['complete', 'cancelled'].includes(task.state)) task.state = 'paused'; task.speed = 0; tasks.set(task.id, task); }
    const secure = JSON.parse(safeStorage.decryptString(Buffer.from(saved.secure, 'base64'))); settings.proxy = secure.proxy || ''; for (const [id, candidate] of secure.candidates) secrets.set(id, candidate);
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') toolStatus = '任务记录无法读取或解密，请检查本机账户及数据文件'; }
  await session.defaultSession.setProxy(proxyConfig(settings.proxy));
  ffmpeg = app.isPackaged ? path.join(process.resourcesPath, 'bin/ffmpeg.exe') : path.join(app.getAppPath(), 'node_modules/ffmpeg-static/ffmpeg.exe');
  ffprobe = app.isPackaged ? path.join(process.resourcesPath, 'bin/ffprobe.exe') : path.join(app.getAppPath(), 'node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
  try { await run(ffprobe, ['-version'], AbortSignal.timeout(10000)); const codecs = await run(ffmpeg, ['-hide_banner', '-encoders'], AbortSignal.timeout(10000)); if (!codecs.includes('libx264') || !codecs.includes('aac')) throw new Error(); } catch { toolStatus = 'FFmpeg/FFprobe 不可用或缺少编码器，请重新安装应用'; }
  win = new BrowserWindow({ width: 1180, height: 820, minWidth: 860, minHeight: 640, backgroundColor: '#eef3f8', title: 'StreamHarbor', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.removeMenu(); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', e => e.preventDefault());
  handle('init', () => ({ settings, tasks: views(), tools: toolStatus }));
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
    if (workers.size || resolveController) throw new DownloadError('BUSY', '请等待解析完成并暂停下载后再修改设置');
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
    const record = workers.get(id);
    if (action === 'pause' || action === 'cancel') {
      if (task.state === 'complete') return;
      if (record) { record.stopping = action === 'pause' ? 'paused' : 'cancelled'; record.child.postMessage({ type: 'abort' }); task.message = '正在停止并保存状态'; }
      else { task.state = action === 'pause' ? 'paused' : 'cancelled'; if (action === 'cancel') { secrets.delete(id); await rm(tempDirectory(task), { recursive: true, force: true }); } }
    } else if (action === 'clean') {
      if (record || refreshing.has(id)) throw new DownloadError('BUSY', '请先停止任务'); await rm(tempDirectory(task), { recursive: true, force: true }); task.message = '临时文件已清理';
    } else {
      if (record || refreshing.has(id) || ['complete', 'cancelled'].includes(task.state)) return;
      if (action === 'restart') {
        const c = secrets.get(id); if (!c) throw new DownloadError('TASK', '请重新解析地址');
        const fresh = await discover(c.source, settings.proxy, AbortSignal.timeout(55000)); const replacement = fresh.find(x => x.kind === c.kind && x.quality === c.quality && x.audioName === c.audioName);
        if (!replacement) throw new DownloadError('CHANGED', '原清晰度或音轨不再存在，请重新解析选择');
        await rm(tempDirectory(task), { recursive: true, force: true }); secrets.set(id, replacement); task.done = 0; task.total = 0;
      }
      if (action === 'mkv' || action === 'transcode') task.mode = action;
      refreshed.delete(id); task.state = 'queued'; task.message = undefined;
    }
    await save(); emit(); void schedule();
  });
  handle('open-output', async (id: string) => { const task = tasks.get(id); if (task?.output) { await access(task.output); shell.showItemInFolder(task.output); } });
  handle('clear-completed', async () => {
    const completed = views().filter(task => task.state === 'complete' && !workers.has(task.id));
    for (const task of completed) tasks.delete(task.id);
    try { await save(); }
    catch (e) { for (const task of completed) tasks.set(task.id, task); emit(); throw e; }
    for (const task of completed) { secrets.delete(task.id); refreshed.delete(task.id); }
    emit();
    return completed.length;
  });
  await win.loadFile(path.join(__dirname, '../ui/index.html'));
});
app.on('second-instance', () => { win?.show(); win?.focus(); });
app.on('login', (event, _webContents, _details, authInfo, callback) => { event.preventDefault(); if (authInfo.isProxy && settings?.proxy) { const u = new URL(settings.proxy); if (u.username) { callback(decodeURIComponent(u.username), decodeURIComponent(u.password)); return; } } callback(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', e => {
  if (quitting) return; e.preventDefault(); quitting = true; resolveController?.abort();
  for (const [id, record] of workers) { record.stopping = 'paused'; record.child.postMessage({ type: 'abort' }); tasks.get(id)!.state = 'paused'; }
  setTimeout(() => { for (const r of workers.values()) r.child.kill(); void save().finally(() => app.quit()); }, workers.size ? 1500 : 0);
});
