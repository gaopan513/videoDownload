import { BrowserWindow, session, type Session } from 'electron';
import { extractMetaHtml, extractMetaText, desktopMetaCandidates, isMetaVideoUrl, metaPlatform, META_MAX_TEXT } from '../core/meta';
import { DownloadError } from '../core/net';
import { extractMediaUrl } from '../core/utils';
import { abortable, proxyConfig } from './resolver';
import type { Candidate, Context } from '../shared';

export async function readyMetaSession(source: string, proxy: string): Promise<Session> {
  const platform = metaPlatform(source);
  if (!platform) throw new DownloadError('URL', '请输入 Instagram 或 Facebook 视频网址');
  const ses = session.fromPartition(`persist:meta-${platform.toLowerCase()}`);
  await ses.setProxy(proxyConfig(proxy));
  ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  return ses;
}

export async function visitMeta(raw: string, proxy: string): Promise<void> {
  if (typeof raw !== 'string' || raw.length > 8192) throw new DownloadError('URL', '网址过长或无效');
  const source = extractMediaUrl(raw);
  if (!isMetaVideoUrl(source)) throw new DownloadError('URL', '请输入 Instagram 或 Facebook 视频网址');
  const browser = new BrowserWindow({ width: 1100, height: 800, title: `${metaPlatform(source)} · 登录后返回工作台解析`, webPreferences: { session: await readyMetaSession(source, proxy), sandbox: true, contextIsolation: true, nodeIntegration: false, disableDialogs: true } });
  browser.removeMenu();
  browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void browser.loadURL(source).catch(() => {});
}

export async function resolveMeta(source: string, proxy: string, signal: AbortSignal, siteSession?: Session): Promise<Candidate[]> {
  if (!isMetaVideoUrl(source)) throw new DownloadError('URL', '请使用 Instagram 帖子 / Reel 或 Facebook 视频 / Reel 的网址');
  signal.throwIfAborted();
  const ses = siteSession || await readyMetaSession(source, proxy);
  if (siteSession) await ses.setProxy(proxyConfig(proxy));
  const browser = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', disableDialogs: true } });
  browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const close = () => { if (!browser.isDestroyed()) browser.destroy(); };
  const preventDownload = (e: Electron.Event) => e.preventDefault();
  signal.addEventListener('abort', close, { once: true });
  ses.on('will-download', preventDownload);
  const found = new Map<string, Candidate>();
  const requests = new Map<string, { page: string; generation: number; readable: boolean }>();
  let pageUrl = source, dashOnly = false, foundAt = 0, navigationError = false;
  let generation = 0, mainFrameId = '', loaderId = '';
  const collect = (parsed: ReturnType<typeof extractMetaText>) => {
    dashOnly ||= parsed.dashOnly;
    for (const c of desktopMetaCandidates(parsed, source, { origin: source, headers: { 'user-agent': ses.getUserAgent() }, cookies: [] })) {
      if (found.size < 100) found.set(c.url, c);
    }
    if (found.size && !foundAt) foundAt = Date.now();
  };
  const debuggerApi = browser.webContents.debugger;
  const message = (_e: Electron.Event, method: string, params: any) => {
    if (method === 'Network.requestWillBeSent') {
      if (params.type === 'Document' && (!mainFrameId || params.frameId === mainFrameId)) { mainFrameId = params.frameId; loaderId = params.loaderId; }
      if (['XHR', 'Fetch'].includes(params.type) && params.frameId === mainFrameId && params.loaderId === loaderId && metaPlatform(params.request.url) === metaPlatform(source) && requests.size < 500) requests.set(params.requestId, { page: params.documentURL, generation, readable: false });
    } else if (method === 'Network.responseReceived') {
      const r = params.response;
      const request = requests.get(params.requestId);
      if (request) request.readable = metaPlatform(r.url) === metaPlatform(source) && /json|javascript|text\/plain/i.test(r.mimeType || '');
    } else if (method === 'Network.loadingFailed') requests.delete(params.requestId);
    else if (method === 'Network.loadingFinished') {
      const at = requests.get(params.requestId); requests.delete(params.requestId);
      if (!at?.readable || at.generation !== generation || at.page !== pageUrl || params.encodedDataLength > META_MAX_TEXT || signal.aborted) return;
      void debuggerApi.sendCommand('Network.getResponseBody', { requestId: params.requestId }).then(result => {
        if (signal.aborted || browser.isDestroyed() || at.generation !== generation || browser.webContents.getURL() !== at.page || at.page !== pageUrl) return;
        const text = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body;
        if (typeof text === 'string' && Buffer.byteLength(text) <= META_MAX_TEXT) collect(extractMetaText(text, at.page, browser.webContents.getTitle()));
      }).catch(() => {});
    }
  };
  browser.webContents.on('did-navigate', (_e, url) => {
    pageUrl = url; generation++; navigationError = false; found.clear(); dashOnly = false; foundAt = 0; requests.clear();
  });
  browser.webContents.on('did-navigate-in-page', (_e, url, main) => {
    if (main && url !== pageUrl) { pageUrl = url; generation++; found.clear(); dashOnly = false; foundAt = 0; requests.clear(); }
  });
  try {
    debuggerApi.attach('1.3'); debuggerApi.on('message', message);
    // Commands may wait for navigation. Dispatch enable before starting loadURL.
    const enabled = debuggerApi.sendCommand('Network.enable', { maxResourceBufferSize: META_MAX_TEXT, maxTotalBufferSize: META_MAX_TEXT * 2 });
    void browser.loadURL(source).catch(e => { if (e.code !== 'ERR_ABORTED' && e.errno !== -3) navigationError = true; });
    await abortable(enabled, signal);
    const started = Date.now();
    while (Date.now() - started < 45000) {
      signal.throwIfAborted();
      if (metaPlatform(pageUrl) !== metaPlatform(source) || /\/(?:accounts\/login|login|checkpoint|challenge)(?:\/|\.php|$)/i.test(new URL(pageUrl).pathname)) throw new DownloadError('AUTH', `${metaPlatform(source)} 需要登录或验证，请点击“访问平台”，完成后重新解析`);
      try {
        const snapshot = await abortable(browser.webContents.executeJavaScript(`(() => { const html = document.documentElement?.outerHTML || ''; document.querySelectorAll('video').forEach(v => { v.muted = true; v.play().catch(() => {}); }); return { url: location.href, html: html.length <= ${META_MAX_TEXT} ? html : '' }; })()`), signal);
        if (snapshot?.url === pageUrl && typeof snapshot.html === 'string') collect(extractMetaHtml(snapshot.html, pageUrl));
      } catch (e) { if (signal.aborted) throw e; }
      if (foundAt && Date.now() - foundAt >= 2000) break;
      if (navigationError && !found.size) throw new DownloadError('HTTP', `${metaPlatform(source)} 页面无法打开，请检查代理或点击“访问平台”重试`);
      await abortable(new Promise(resolve => setTimeout(resolve, 500)), signal);
    }
    signal.throwIfAborted();
    if (!found.size) throw new DownloadError(dashOnly ? 'DASH' : 'DISCOVERY', dashOnly ? '该视频仅提供 DASH 分离音视频轨道，当前支持完整 MP4；请尝试其他视频' : `${metaPlatform(source)} 未提供可下载的完整 MP4，请点击“访问平台”确认视频可播放，登录或验证后重新解析`);
    const cookies: Context['cookies'] = (await ses.cookies.get({})).map(c => ({ name: c.name, value: c.value, domain: c.domain || new URL(pageUrl).hostname, path: c.path || '/', secure: !!c.secure }));
    return [...found.values()].map(c => ({ ...c, context: { ...c.context, cookies } }));
  } finally {
    signal.removeEventListener('abort', close);
    debuggerApi.removeListener('message', message);
    if (!browser.isDestroyed() && debuggerApi.isAttached()) debuggerApi.detach();
    close(); ses.removeListener('will-download', preventDownload);
  }
}
