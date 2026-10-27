import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { ProxyAgent } from 'proxy-agent';
import type { Context } from '../shared';

export class DownloadError extends Error { constructor(public code: string, message: string) { super(message); } }
export function webUrl(value: string) { const u = new URL(value); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new DownloadError('URL', '仅支持不含账号密码的 HTTP/HTTPS 地址'); return u; }
export function cleanError(e: unknown): string {
  if (e instanceof DownloadError) return e.message;
  if ((e as Error)?.name === 'AbortError') return '操作已停止';
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === 'ENOSPC') return '磁盘空间不足，请清理空间后重试';
  if (code === 'EACCES' || code === 'EPERM') return '目录无法写入，或文件被其他程序占用';
  return code ? `操作失败（${String(code).replace(/[^A-Z0-9_]/g, '')}），请检查网络、代理和目录` : '处理失败，请检查资源格式或重新解析';
}
export function requestHeaders(url: string, ctx: Context): Record<string, string> {
  const u = webUrl(url); const out: Record<string, string> = { 'accept-encoding': 'identity', 'user-agent': ctx.headers['user-agent'] || 'Mozilla/5.0', referer: ctx.headers.referer || ctx.origin };
  // Never replay credentials to a different origin.
  if (u.origin === new URL(ctx.origin).origin) for (const [k, v] of Object.entries(ctx.headers)) if (['authorization', 'origin', 'accept'].includes(k.toLowerCase())) out[k] = v;
  const cookies = ctx.cookies.filter(c => {
    const domain = c.domain.replace(/^\./, '').toLowerCase();
    const domainOk = c.domain.startsWith('.') ? u.hostname === domain || u.hostname.endsWith('.' + domain) : u.hostname === domain;
    const pathOk = u.pathname === c.path || (u.pathname.startsWith(c.path) && (c.path.endsWith('/') || u.pathname[c.path.length] === '/'));
    return domainOk && pathOk && (!c.secure || u.protocol === 'https:');
  });
  if (cookies.length) out.cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  return out;
}
let resolveSystemProxy: ((url: string) => Promise<string>) | undefined;
export function setProxyResolver(fn: (url: string) => Promise<string>) { resolveSystemProxy = fn; }
export class Network {
  agent: ProxyAgent;
  constructor(public context: Context, proxy = '') { this.agent = new ProxyAgent({ getProxyForUrl: url => proxy || resolveSystemProxy?.(url) || '' }); }
  close() { this.agent.destroy(); }
  async open(url: string, signal: AbortSignal, extra: Record<string, string> = {}, redirects = 0): Promise<IncomingMessage & { url: string }> {
    const u = webUrl(url);
    const res = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = (u.protocol === 'https:' ? https : http).request(u, { agent: this.agent, headers: { ...requestHeaders(url, this.context), ...extra }, signal }, response => { clearTimeout(connectTimer); resolve(response); });
      const connectTimer = setTimeout(() => req.destroy(new DownloadError('TIMEOUT', '连接服务器超时')), 20000);
      req.on('error', e => { clearTimeout(connectTimer); reject(e); }); req.setTimeout(30000, () => req.destroy(new DownloadError('TIMEOUT', '网络请求超时'))); req.end();
    });
    if ([301, 302, 303, 307, 308].includes(res.statusCode!)) {
      res.resume(); if (redirects >= 8 || !res.headers.location) throw new DownloadError('REDIRECT', '重定向次数过多或地址无效');
      return this.open(new URL(res.headers.location, url).href, signal, extra, redirects + 1);
    }
    if (res.statusCode === 401 || res.statusCode === 403) { res.resume(); throw new DownloadError('AUTH', '资源需要授权或下载地址已过期'); }
    if (!res.statusCode || res.statusCode >= 400) { res.resume(); throw new DownloadError(res.statusCode! >= 500 || res.statusCode === 429 ? 'RETRY' : 'HTTP', `服务器返回 HTTP ${res.statusCode}`); }
    return Object.assign(res, { url: u.href });
  }
  async bytes(url: string, signal: AbortSignal, headers: Record<string, string> = {}, limit = 64 * 1024 * 1024) {
    const res = await this.open(url, signal, headers); const chunks: Buffer[] = []; let count = 0;
    for await (const chunk of res) { count += chunk.length; if (count > limit) { res.destroy(); throw new DownloadError('LIMIT', '资源超出安全读取大小限制'); } chunks.push(chunk); }
    return { data: Buffer.concat(chunks), headers: res.headers, status: res.statusCode, url: res.url };
  }
}
export async function retry<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let i = 0; ; i++) {
    signal.throwIfAborted();
    try { return await fn(); } catch (e) {
      if (signal.aborted || i >= 3 || (e instanceof DownloadError && !['RETRY', 'TIMEOUT'].includes(e.code))) throw e;
      await new Promise<void>((resolve, reject) => { const end = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); }; const abort = () => { end(); reject(signal.reason); }; const timer = setTimeout(() => { end(); resolve(); }, 500 * 2 ** i); signal.addEventListener('abort', abort, { once: true }); });
    }
  }
}
export async function pool<T>(items: T[], count: number, fn: (item: T, index: number) => Promise<void>) {
  let cursor = 0; let error: unknown;
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => {
    while (cursor < items.length && !error) { const i = cursor++; try { await fn(items[i], i); } catch (e) { error = e; } }
  }));
  if (error) throw error;
}
