import { randomUUID } from 'node:crypto';
import { DownloadError } from '../net';
import { cleanTitle } from '../utils';
import type { Candidate, Context } from '../../shared';

export const WEIBO_CONTEXT: Context = {
  origin: 'https://weibo.com',
  headers: {
    referer: 'https://weibo.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  },
  cookies: []
};

const WEIBO_HOST_PATTERN = /(?:^|\.)(?:weibo\.com|weibo\.cn)$/i;

export function isWeiboUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return WEIBO_HOST_PATTERN.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function parseWeiboId(url: string): string | null {
  try {
    const parsed = new URL(url);
    // /detail/5012345678901234 或 /status/5012345678901234
    const idMatch = parsed.pathname.match(/(?:detail|status)\/([a-zA-Z0-9]+)/i);
    if (idMatch) return idMatch[1];
    // /fid=1034:xxx
    const fidMatch = parsed.searchParams.get('fid');
    if (fidMatch) return fidMatch;
    // /1234567890/xxxxxxx
    const userPostMatch = parsed.pathname.match(/\/\d+\/([a-zA-Z0-9]+)/);
    if (userPostMatch) return userPostMatch[1];
    return null;
  } catch {
    return null;
  }
}

export function buildWeiboApiUrl(id: string): string {
  return `https://m.weibo.cn/statuses/show?id=${id}`;
}

export function parseWeiboResponse(data: any, originalUrl: string): Candidate[] {
  if (!data || typeof data !== 'object') {
    throw new DownloadError('DISCOVERY', '微博数据为空或格式错误');
  }

  const status = data.data || data;
  const pageInfo = status.page_info;
  if (!pageInfo || (pageInfo.type !== 'video' && !pageInfo.media_info)) {
    throw new DownloadError('DISCOVERY', '该微博为图文内容或未包含可下载的视频');
  }

  const media = pageInfo.media_info || {};
  const urls: { quality: string; url: string; score: number }[] = [];

  // 1. 优先从 playback_list 中获取多清晰度
  if (Array.isArray(media.playback_list) && media.playback_list.length > 0) {
    for (const item of media.playback_list) {
      const playInfo = item.play_info;
      if (playInfo && playInfo.url) {
        const quality = playInfo.quality_label || playInfo.quality_desc || '高清';
        const bitrate = playInfo.bitrate || 0;
        urls.push({ quality, url: playInfo.url, score: bitrate });
      }
    }
  }

  // 2. 检查常见字段
  if (media.mp4_720p_mp4) urls.push({ quality: '720P 高清', url: media.mp4_720p_mp4, score: 720 });
  if (media.mp4_hd_url) urls.push({ quality: '高清', url: media.mp4_hd_url, score: 540 });
  if (media.stream_url_hd) urls.push({ quality: '高清', url: media.stream_url_hd, score: 500 });
  if (media.stream_url) urls.push({ quality: '标清', url: media.stream_url, score: 360 });
  if (media.mp4_sd_url) urls.push({ quality: '标清', url: media.mp4_sd_url, score: 300 });

  if (!urls.length) {
    throw new DownloadError('DISCOVERY', '未找到微博视频下载直链');
  }

  // 按 score 降序并去重
  urls.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  // 清洗微博文本作为标题
  const author = status.user?.screen_name ? `${status.user.screen_name}: ` : '';
  const cleanText = status.text || pageInfo.content2 || '微博视频';
  const title = cleanTitle(`${author}${cleanText}`);

  for (const item of urls) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    candidates.push({
      id: randomUUID(),
      title,
      url: item.url,
      source: originalUrl,
      kind: 'mp4',
      quality: item.quality,
      context: WEIBO_CONTEXT
    });
  }

  return candidates;
}
