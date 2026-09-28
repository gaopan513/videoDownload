import { randomUUID } from 'node:crypto';
import { DownloadError } from '../net';
import { cleanTitle, extractHtmlState } from '../utils';
import type { Candidate, Context } from '../../shared';

export const XIGUA_CONTEXT: Context = {
  origin: 'https://www.ixigua.com',
  headers: {
    referer: 'https://www.ixigua.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  },
  cookies: []
};

const XIGUA_HOST_PATTERN = /(?:^|\.)(?:ixigua\.com|xigua\.com)$/i;

export function isXiguaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return XIGUA_HOST_PATTERN.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function parseXiguaId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/(?:video\/)?(\d{15,22})/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(str: string): string {
  try {
    return Buffer.from(str, 'base64').toString('utf8');
  } catch {
    return str;
  }
}

export function parseXiguaHtml(html: string, originalUrl: string): Candidate[] {
  if (!html || typeof html !== 'string') {
    throw new DownloadError('DISCOVERY', '西瓜视频页面数据为空');
  }

  const state = extractHtmlState(html, /window\._SSR_HYDRATED_DATA\s*=\s*({.+?});?<\/script>/s);
  if (!state) {
    throw new DownloadError('DISCOVERY', '未能从西瓜视频页面读取数据');
  }

  // 寻找视频详情节点
  const packerData = state.anyVideo?.gidInformation?.packerData || state.packerData;
  const videoData = packerData?.videoResource?.normal || packerData?.video;
  if (!videoData) {
    throw new DownloadError('DISCOVERY', '西瓜视频不存在或已被作者删除');
  }

  const videoList = videoData.video_list || videoData.videoResource?.normal?.video_list;
  if (!videoList || typeof videoList !== 'object') {
    throw new DownloadError('DISCOVERY', '未找到西瓜视频播放列表');
  }

  const candidates: Candidate[] = [];
  const title = cleanTitle(packerData?.title || packerData?.video?.title || '西瓜视频');

  const keys = Object.keys(videoList);
  // 按清晰度排序 (video_4 > video_3 > video_2 > video_1)
  keys.sort().reverse();

  for (const key of keys) {
    const item = videoList[key];
    if (!item?.main_url) continue;
    const realUrl = decodeBase64Url(item.main_url);
    const quality = item.definition || item.quality || `${item.vheight || ''}P` || '高清';
    candidates.push({
      id: randomUUID(),
      title,
      url: realUrl,
      source: originalUrl,
      kind: 'mp4',
      quality,
      context: XIGUA_CONTEXT
    });
  }

  if (!candidates.length) {
    throw new DownloadError('DISCOVERY', '未找到西瓜视频下载直链');
  }

  return candidates;
}
