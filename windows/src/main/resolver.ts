import { BrowserWindow, session, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import * as cheerio from 'cheerio';
import { parse } from '../core/hls';
import { DownloadError, webUrl } from '../core/net';
import { isTwitterUrl } from '../core/twitter';
import { isYoutubeUrl } from '../core/youtube';
import { extractMediaUrl } from '../core/utils';
import { resolveTwitter } from './twitter';
import { resolveYoutube } from './youtube';
import { resolveDomestic } from './platforms';
import { metaPlatform } from '../core/meta';
import { resolveMeta } from './meta';
import type { Candidate, Context } from '../shared';
const mediaPath = (url: string, kind = 'mp4|m3u8') => { try { return new RegExp('\\.(' + kind + ')$', 'i').test(new URL(url).pathname); } catch { return false; } };
const discard = (response: Response) => { void response.body?.cancel().catch(() => {}); };
const sessionResolutions = new WeakMap<Session, Promise<void>>();

async function acquireSession(ses: Session, signal: AbortSignal) {
  const previous = sessionResolutions.get(ses) || Promise.resolve();
  let unlock!: () => void;
  const current = new Promise<void>(resolve => { unlock = resolve; });
  const tail = previous.then(() => current);
  sessionResolutions.set(ses, tail);
  const release = () => { unlock(); if (sessionResolutions.get(ses) === tail) sessionResolutions.delete(ses); };
  try { await abortable(previous, signal); signal.throwIfAborted(); }
  catch (error) { void previous.then(release); throw error; }
  return release;
}

export function abortable<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DownloadError('TIMEOUT', '解析已停止或超时，请检查网络与页面访问条件'));
    if (signal.aborted) { void promise.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function proxyConfig(proxy: string) { if (!proxy) return { mode: 'system' as const }; const u = new URL(proxy); u.username = ''; u.password = ''; return { mode: 'fixed_servers' as const, proxyRules: u.href.replace(/\/$/, '').replace(/^socks5h:/, 'socks5:'), proxyBypassRules: '<-loopback>' }; }
export async function fetchAt(ses: Session, url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  const referrer = headers.get('referer');
  init = { ...init, headers, ...(referrer ? { referrer, referrerPolicy: 'unsafe-url' as const } : {}) };
  // Electron net.fetch may leave Response.url empty. Track redirects ourselves.
  // 看门狗：服务器返回非法状态码时 net.fetch 会挂起不走拒绝（主进程守卫只吞异常），20s 强制超时。
  for (let n = 0; n < 9; n++) {
    webUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let response: Response;
    try {
      const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
      response = await abortable(ses.fetch(url, { ...init, signal, redirect: 'manual' }), signal);
    } finally { clearTimeout(timeout); }
    if ([301, 302, 303, 307, 308].includes(response.status)) { const location = response.headers.get('location'); discard(response); if (!location) throw new DownloadError('REDIRECT', '网页重定向缺少目标地址'); url = new URL(location, url).href; continue; }
    Object.defineProperty(response, 'url', { value: url }); return response;
  }
  throw new DownloadError('REDIRECT', '网页重定向次数过多');
}
export async function readLimited(response: Response, limit = 4 * 1024 * 1024, signal?: AbortSignal) {
  if (!response.body) return ''; const reader = response.body.getReader(); let size = 0; const buffers: Uint8Array[] = [];
  try { for (;;) { const { done, value } = await abortable(reader.read(), signal); if (done) break; size += value.length; if (size > limit) throw new DownloadError('LIMIT', '页面或播放列表过大'); buffers.push(value); } } finally { void reader.cancel().catch(() => {}); }
  return Buffer.concat(buffers).toString('utf8');
}
export async function discover(source: string, proxy: string, signal: AbortSignal, siteSession?: Session): Promise<Candidate[]> {
  source = extractMediaUrl(source);
  webUrl(source);
  if (metaPlatform(source)) return await resolveMeta(source, proxy, signal, siteSession);
  if (isTwitterUrl(source)) {
    return await resolveTwitter(source, proxy, signal);
  }
  if (isYoutubeUrl(source)) {
    return await resolveYoutube(source, proxy, signal);
  }
  try {
    const domestic = await resolveDomestic(source, proxy, signal);
    if (domestic && domestic.length) {
      return domestic;
    }
  } catch (err) {
    if (signal.aborted || (err instanceof DownloadError && (['URL', 'UNSUPPORTED'].includes(err.code) || err.message.includes('图文')))) {
      throw err;
    }
  }
  const ses = siteSession || session.fromPartition('resolve-' + randomUUID());
  // ponytail: serialize discovery per login session; use a dispatcher if parallel capture is needed.
  const release = await acquireSession(ses, signal);
  const found = new Map<string, { url: string; headers: Record<string, string> }>(); let title = '视频'; let browser: BrowserWindow | undefined;
  let capturing = false;
  const stopCapture = () => {
    if (!capturing) return;
    capturing = false;
    ses.webRequest.onBeforeSendHeaders(null); ses.webRequest.onHeadersReceived(null); ses.webRequest.onCompleted(null); ses.webRequest.onErrorOccurred(null);
  };
  const preventDownload = (e: Electron.Event, _item: Electron.DownloadItem, contents: Electron.WebContents) => { if (contents?.id === browser?.webContents.id) e.preventDefault(); };
  const add = (value: string, base = source, headers: Record<string, string> = {}) => { try { const u = webUrl(new URL(value, base).href).href; if (found.size < 100) found.set(u, { url: u, headers }); } catch {} };
  const abort = () => { if (browser && !browser.isDestroyed()) browser.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    await ses.setProxy(proxyConfig(proxy));
    signal.throwIfAborted();
    ses.setPermissionRequestHandler((_w, _p, cb) => cb(false)); ses.setPermissionCheckHandler(() => false);
    // Web pages must run their normal navigation (including challenge reloads).
    // Reserve net.fetch preflight for explicit media URLs.
    try {
      if (!mediaPath(source)) throw new Error('Browser navigation required');
      const first = await fetchAt(ses, source, { signal, headers: { Range: 'bytes=0-0' } });
      if (!first.ok) { discard(first); throw new DownloadError('HTTP', `页面返回 HTTP ${first.status}，可能需要授权或人工验证`); }
      const type = first.headers.get('content-type') || '';
      if (/video\/|mpegurl/i.test(type) || mediaPath(first.url)) { add(first.url); discard(first); }
      else {
        const html = await readLimited(first, 4 * 1024 * 1024, signal); const $ = cheerio.load(html); title = $('title').text().trim().slice(0, 100) || title;
        $('video[src],source[src]').each((_, e) => { const src = $(e).attr('src'); if (src) add(src, first.url); });
        // 协议相对地址（//host/x.m3u8）在 CMS 类页面常见，一并捕获
        for (const m of html.replace(/\\\//g, '/').matchAll(/(?:https?:)?\/\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/gi)) add(m[0], first.url);
      }
    } catch (e) { if (signal.aborted) throw e; found.clear(); }
    if (!found.size) {
      browser = new BrowserWindow({ show: false, width: 1100, height: 740, webPreferences: { session: ses, sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', disableDialogs: true } });
      browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      ses.on('will-download', preventDownload);
      const requests = new Map<number, Record<string, string>>();
      const browserId = browser.webContents.id;
      capturing = true;
      ses.webRequest.onBeforeSendHeaders((d, cb) => { if (d.webContentsId === browserId) requests.set(d.id, Object.fromEntries(Object.entries(d.requestHeaders).map(([k, v]) => [k.toLowerCase(), String(v)]))); cb({ requestHeaders: d.requestHeaders }); });
      ses.webRequest.onHeadersReceived((d, cb) => { const content = Object.entries(d.responseHeaders || {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1]?.join() || ''; if (d.webContentsId === browserId && (/video\/(mp4|x-m4v)|mpegurl/i.test(content) || mediaPath(d.url))) add(d.url, source, requests.get(d.id)); cb({}); });
      ses.webRequest.onCompleted(d => requests.delete(d.id)); ses.webRequest.onErrorOccurred(d => requests.delete(d.id));
      void browser.loadURL(source).catch(() => {});
      const started = Date.now(); let foundAt = 0;
      while (Date.now() - started < 45000) {
        signal.throwIfAborted(); if (found.size && !foundAt) foundAt = Date.now(); if (foundAt && Date.now() - foundAt > 2500) break;
        if (!browser.isDestroyed()) {
          title = browser.webContents.getTitle() || title;
          const frames = browser.webContents.mainFrame.framesInSubtree;
          await abortable(Promise.race([new Promise(r => setTimeout(r, 1200)), Promise.allSettled(frames.map(frame => frame.executeJavaScript(`(() => { const videos = Array.from(document.querySelectorAll('video')); videos.forEach(v => { v.muted = true; v.play().catch(() => {}); }); return videos.map(v => v.currentSrc || v.src).filter(Boolean); })()`).then(urls => { if (Array.isArray(urls)) urls.forEach(u => { if (typeof u === 'string') add(u, frame.url || source, { referer: frame.url || source }); }); })))]), signal);
        }
        await new Promise(r => setTimeout(r, 800));
      }
    }
    signal.throwIfAborted();
    stopCapture();
    const cookies = await ses.cookies.get({}); const result: Candidate[] = []; let lastError: unknown;
    for (const item of found.values()) {
      signal.throwIfAborted();
      const context: Context = { origin: item.url, headers: { ...item.headers, referer: item.headers.referer || source }, cookies: cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain || new URL(source).hostname, path: c.path || '/', secure: !!c.secure })) };
      const base = { title, source, context };
      try {
        const response = await fetchAt(ses, item.url, { signal, headers: { referer: context.headers.referer, Range: 'bytes=0-0' } });
        if (!response.ok) { discard(response); continue; }
        const type = response.headers.get('content-type') || '';
        if (/mpegurl/i.test(type) || mediaPath(item.url, 'm3u8')) {
          discard(response);
          const full = await fetchAt(ses, item.url, { signal, headers: { referer: context.headers.referer } });
          const m = parse(await readLimited(full, 4 * 1024 * 1024, signal));
          if (m.playlists?.length) {
            for (const p of m.playlists) {
              const quality = p.attributes?.RESOLUTION ? `${p.attributes.RESOLUTION.height}p` : p.attributes?.BANDWIDTH ? `${Math.round(p.attributes.BANDWIDTH / 1000)} kbps` : '默认清晰度';
              const tracks = m.mediaGroups?.AUDIO?.[p.attributes?.AUDIO];
              const audio = tracks ? Object.entries(tracks).filter(([, v]: any) => v.uri) : [];
              for (const [name, a] of audio.length ? audio : [['', undefined]]) result.push({ ...base, id: randomUUID(), url: new URL(p.uri, full.url).href, kind: 'hls', quality, audioUrl: (a as any)?.uri ? new URL((a as any).uri, full.url).href : undefined, audioName: name as string || undefined });
            }
          } else {
            if (!m.endList) throw new DownloadError('LIVE', '检测到直播或尚未结束的播放列表，首版不支持录制');
            result.push({ ...base, id: randomUUID(), url: full.url, kind: 'hls' });
          }
        } else {
          discard(response);
          if (/video\/|octet-stream/i.test(type) || mediaPath(item.url, 'mp4')) result.push({ ...base, id: randomUUID(), url: response.url, kind: 'mp4' });
        }
      } catch (e) { if (signal.aborted) throw e; lastError = e; }
    }
    if (!result.length) throw lastError || new DownloadError('DISCOVERY', '未发现可下载的完整视频；页面可能需要登录、人工播放、验证或专用适配');
    return result;
  } finally {
    try { signal.removeEventListener('abort', abort); abort(); ses.removeListener('will-download', preventDownload); stopCapture(); if (!siteSession) { void ses.clearStorageData().catch(() => {}); void ses.closeAllConnections(); } }
    finally { release(); }
  }
}

