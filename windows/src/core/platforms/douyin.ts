import { randomUUID } from 'node:crypto';
import { DownloadError } from '../net';
import { cleanTitle, extractHtmlState } from '../utils';
import type { Candidate, Context } from '../../shared';

export const DOUYIN_CONTEXT: Context = {
  origin: 'https://www.douyin.com',
  headers: {
    referer: 'https://www.douyin.com/',
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
  },
  cookies: []
};

const DOUYIN_HOST_PATTERN = /(?:^|\.)(?:douyin\.com|iesdouyin\.com)$/i;

export function isDouyinUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return DOUYIN_HOST_PATTERN.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function parseDouyinId(url: string): string | null {
  try {
    const parsed = new URL(url);
    // /video/7123456789012345678 或 /note/7123456789012345678 或 modal_id=xxx
    const pathMatch = parsed.pathname.match(/(?:video|note)\/(\d+)/i);
    if (pathMatch) return pathMatch[1];
    const modalMatch = parsed.searchParams.get('modal_id');
    if (modalMatch && /^\d+$/.test(modalMatch)) return modalMatch;
    const directMatch = parsed.pathname.match(/\/(\d{18,21})/);
    if (directMatch) return directMatch[1];
    return null;
  } catch {
    return null;
  }
}

export function buildDouyinApiUrl(itemId: string): string {
  return `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${itemId}`;
}

export function parseDouyinResponse(data: any, originalUrl: string): Candidate[] {
  if (!data || typeof data !== 'object') {
    throw new DownloadError('DISCOVERY', '抖音数据格式无法解析');
  }

  const item = data.item_list?.[0] || data.aweme_detail || data;
  if (!item || (!item.video && !item.images)) {
    throw new DownloadError('DISCOVERY', '抖音视频不存在或已被作者删除');
  }

  // 纯图文笔记判定
  if (Array.isArray(item.images) && item.images.length > 0 && (!item.video || !item.video.play_addr)) {
    throw new DownloadError('DISCOVERY', '该抖音内容为图文，未包含视频');
  }

  const video = item.video;
  if (!video) {
    throw new DownloadError('DISCOVERY', '该内容未包含可下载的视频流');
  }

  const urlList = video.play_addr?.url_list || video.play_addr_h264?.url_list || [];
  if (!Array.isArray(urlList) || !urlList.length) {
    throw new DownloadError('DISCOVERY', '未找到抖音视频下载地址');
  }

  // 提取无水印原画直链：将 playwm 替换为 play
  let rawUrl = urlList[0];
  if (typeof rawUrl === 'string') {
    rawUrl = rawUrl.replace(/playwm/g, 'play');
    // 强制使用 https
    rawUrl = rawUrl.replace(/^http:\/\//i, 'https://');
  }

  const desc = item.desc || '抖音视频';
  const author = item.author?.nickname ? `${item.author.nickname}: ` : '';
  const title = cleanTitle(`${author}${desc}`);

  const quality = video.ratio ? `${video.ratio} 无水印原画` : '无水印原画';

  return [{
    id: randomUUID(),
    title,
    url: rawUrl,
    source: originalUrl,
    kind: 'mp4',
    quality,
    context: DOUYIN_CONTEXT
  }];
}

export function parseDouyinHtml(html: string, originalUrl: string): Candidate[] {
  // 备用：从页面 HTML _SSR_HYDRATED_DATA 或 RENDER_DATA 中提取
  const parsed = extractHtmlState(html, /window\._SSR_HYDRATED_DATA\s*=\s*({.+?});?<\/script>/s) ||
                 extractHtmlState(html, /<script id="RENDER_DATA" type="application\/json">(.+?)<\/script>/s);
  if (parsed) {
    const findAweme = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.awemeDetail || obj.aweme_detail) return obj.awemeDetail || obj.aweme_detail;
      if (obj.video?.play_addr) return obj;
      for (const k of Object.keys(obj)) {
        const res = findAweme(obj[k]);
        if (res) return res;
      }
      return null;
    };
    const aweme = findAweme(parsed);
    if (aweme) {
      return parseDouyinResponse(aweme, originalUrl);
    }
  }
  throw new DownloadError('DISCOVERY', '未能从抖音网页中解析出视频数据');
}
