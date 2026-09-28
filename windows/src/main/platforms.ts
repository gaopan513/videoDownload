import { session, type Session } from 'electron';
import { DownloadError } from '../core/net';
import {
  isBilibiliUrl,
  parseBilibiliId,
  buildBilibiliViewUrl,
  buildBilibiliPlayUrl,
  parseBilibiliResponse,
  BILIBILI_CONTEXT,
  isDouyinUrl,
  parseDouyinId,
  buildDouyinApiUrl,
  parseDouyinResponse,
  parseDouyinHtml,
  DOUYIN_CONTEXT,
  isKuaishouUrl,
  parseKuaishouHtml,
  KUAISHOU_CONTEXT,
  isWeiboUrl,
  parseWeiboId,
  buildWeiboApiUrl,
  parseWeiboResponse,
  WEIBO_CONTEXT,
  isXhsUrl,
  parseXhsHtml,
  XHS_CONTEXT,
  isXiguaUrl,
  parseXiguaHtml,
  XIGUA_CONTEXT
} from '../core/platforms';
import { fetchAt, readLimited, proxyConfig } from './resolver';
import type { Candidate } from '../shared';

async function fetchJson(ses: Session, url: string, headers: Record<string, string>, signal: AbortSignal): Promise<any> {
  const res = await fetchAt(ses, url, { signal, headers });
  const text = await readLimited(res, 2 * 1024 * 1024, signal);
  try {
    return JSON.parse(text);
  } catch {
    throw new DownloadError('DISCOVERY', '服务响应非正常 JSON 格式，可能触发了平台验证或反爬');
  }
}

async function fetchHtml(ses: Session, url: string, headers: Record<string, string>, signal: AbortSignal): Promise<string> {
  const res = await fetchAt(ses, url, { signal, headers });
  return await readLimited(res, 4 * 1024 * 1024, signal);
}

export function isDomesticPlatformUrl(url: string): boolean {
  return isBilibiliUrl(url) ||
         isDouyinUrl(url) ||
         isKuaishouUrl(url) ||
         isWeiboUrl(url) ||
         isXhsUrl(url) ||
         isXiguaUrl(url);
}

export async function resolveDomestic(source: string, proxy: string, signal: AbortSignal): Promise<Candidate[] | null> {
  if (!isDomesticPlatformUrl(source)) {
    return null;
  }

  // 使用固定沙箱分区，避免随机 UUID 导致 Electron C++ 层面 BrowserContext 永久驻留造成内存泄漏
  const ses = session.fromPartition('resolve-domestic');
  await ses.setProxy(proxyConfig(proxy));
  ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);

  try {
    signal.throwIfAborted();

    // 1. 哔哩哔哩 (Bilibili)
    if (isBilibiliUrl(source)) {
      let realUrl = source;
      if (source.includes('b23.tv')) {
        const headRes = await fetchAt(ses, source, { signal, headers: BILIBILI_CONTEXT.headers });
        realUrl = headRes.url || source;
        headRes.body?.cancel().catch(() => {}); // 显式关闭释放流
      }
      const id = parseBilibiliId(realUrl);
      if (!id) throw new DownloadError('URL', '未识别到有效的哔哩哔哩 BV 号或 av 号');

      const viewJson = await fetchJson(ses, buildBilibiliViewUrl(id), BILIBILI_CONTEXT.headers, signal);
      const cid = viewJson?.data?.cid;
      if (!cid) throw new DownloadError('DISCOVERY', '未能获取哔哩哔哩视频 cid');

      const playJson = await fetchJson(ses, buildBilibiliPlayUrl(id, cid), BILIBILI_CONTEXT.headers, signal);
      return parseBilibiliResponse(viewJson, playJson, source);
    }

    // 2. 抖音 (Douyin)
    if (isDouyinUrl(source)) {
      let realUrl = source;
      const headRes = await fetchAt(ses, source, { signal, headers: DOUYIN_CONTEXT.headers });
      realUrl = headRes.url || source;
      const itemId = parseDouyinId(realUrl) || parseDouyinId(source);

      // 先尝试官方移动端 API
      if (itemId) {
        try {
          const apiJson = await fetchJson(ses, buildDouyinApiUrl(itemId), DOUYIN_CONTEXT.headers, signal);
          headRes.body?.cancel().catch(() => {}); // 释放落地页连接
          return parseDouyinResponse(apiJson, source);
        } catch (e) {
          if (signal.aborted) throw e;
          if (e instanceof DownloadError && e.message.includes('图文')) {
            headRes.body?.cancel().catch(() => {});
            throw e;
          }
        }
      }

      // 降级从页面 HTML 提取
      const html = await readLimited(headRes, 4 * 1024 * 1024, signal);
      return parseDouyinHtml(html, source);
    }

    // 3. 快手 (Kuaishou)
    if (isKuaishouUrl(source)) {
      const html = await fetchHtml(ses, source, KUAISHOU_CONTEXT.headers, signal);
      return parseKuaishouHtml(html, source);
    }

    // 4. 微博 (Weibo)
    if (isWeiboUrl(source)) {
      const id = parseWeiboId(source);
      if (!id) throw new DownloadError('URL', '未识别到有效的微博 ID');

      const apiJson = await fetchJson(ses, buildWeiboApiUrl(id), WEIBO_CONTEXT.headers, signal);
      return parseWeiboResponse(apiJson, source);
    }

    // 5. 小红书 (Xiaohongshu)
    if (isXhsUrl(source)) {
      const html = await fetchHtml(ses, source, XHS_CONTEXT.headers, signal);
      return parseXhsHtml(html, source);
    }

    // 6. 西瓜视频 (Xigua)
    if (isXiguaUrl(source)) {
      const html = await fetchHtml(ses, source, XIGUA_CONTEXT.headers, signal);
      return parseXiguaHtml(html, source);
    }

    return null;
  } finally {
    void ses.clearStorageData().catch(() => {});
    void ses.closeAllConnections().catch(() => {});
  }
}
