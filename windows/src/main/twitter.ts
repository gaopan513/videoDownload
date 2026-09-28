import { session } from 'electron';
import { randomUUID } from 'node:crypto';
import { DownloadError } from '../core/net';
import {
  parseTweetId,
  buildSyndicationUrl,
  buildFxTwitterUrl,
  parseSyndicationResponse,
  parseFxTwitterResponse
} from '../core/twitter';
import { fetchAt, readLimited, proxyConfig } from './resolver';
import type { Candidate } from '../shared';

export async function resolveTwitter(source: string, proxy: string, signal: AbortSignal): Promise<Candidate[]> {
  const tweetId = parseTweetId(source);
  if (!tweetId) throw new DownloadError('URL', '非法的 Twitter/X 推文链接');

  const ses = session.fromPartition('resolve-tw-' + randomUUID());
  await ses.setProxy(proxyConfig(proxy));

  let lastError: unknown;
  try {
    // 通道 1：Twitter 官方 Syndication API (免登录，全分辨率直链)
    try {
      signal.throwIfAborted();
      const syndicationUrl = buildSyndicationUrl(tweetId);
      const res = await fetchAt(ses, syndicationUrl, {
        signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          referer: 'https://platform.twitter.com/',
          accept: 'application/json'
        }
      });
      if (res.ok) {
        const body = await readLimited(res, 4 * 1024 * 1024, signal);
        const data = JSON.parse(body);
        return parseSyndicationResponse(data, source);
      }
      if (res.status === 404) {
        lastError = new DownloadError('DISCOVERY', '推文不存在或已被作者删除');
      } else if (res.status === 403) {
        lastError = new DownloadError('AUTH', '该推文已被保护或需要登录查看');
      } else {
        lastError = new DownloadError('HTTP', `Twitter 服务响应异常 HTTP ${res.status}`);
      }
    } catch (e) {
      if (signal.aborted) throw e;
      lastError = e;
    }

    // 通道 2：备用 CDN 接口 (FxTwitter API)
    try {
      signal.throwIfAborted();
      const fbUrl = buildFxTwitterUrl(tweetId);
      const fbRes = await fetchAt(ses, fbUrl, {
        signal,
        headers: {
          'user-agent': 'StreamHarbor/1.0 (+https://github.com/gaopan513/videoDownload)',
          accept: 'application/json'
        }
      });
      if (fbRes.ok) {
        const body = await readLimited(fbRes, 4 * 1024 * 1024, signal);
        const data = JSON.parse(body);
        return parseFxTwitterResponse(data, source);
      }
      if (fbRes.status === 404) {
        throw new DownloadError('DISCOVERY', '推文不存在或已被作者删除');
      }
      if (fbRes.status === 429) {
        throw new DownloadError('RETRY', 'Twitter 接口访问受限，请稍后重试或在设置中配置代理');
      }
    } catch (e) {
      if (signal.aborted) throw e;
      if (e instanceof DownloadError) throw e;
      lastError = e;
    }

    throw lastError || new DownloadError('DISCOVERY', '未能获取该推文视频，可能包含敏感内容、需要登录或已被删除');
  } finally {
    void ses.clearStorageData().catch(() => {});
    void ses.closeAllConnections().catch(() => {});
  }
}
