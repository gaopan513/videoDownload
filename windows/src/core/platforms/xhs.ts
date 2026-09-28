import { randomUUID } from 'node:crypto';
import { DownloadError } from '../net';
import { cleanTitle, extractHtmlState } from '../utils';
import type { Candidate, Context } from '../../shared';

export const XHS_CONTEXT: Context = {
  origin: 'https://www.xiaohongshu.com',
  headers: {
    referer: 'https://www.xiaohongshu.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  },
  cookies: []
};

const XHS_HOST_PATTERN = /(?:^|\.)(?:xiaohongshu\.com|xhslink\.com)$/i;

export function isXhsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return XHS_HOST_PATTERN.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function parseXhsId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/(?:explore|discovery\/item)\/([a-fA-F0-9]+)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function parseXhsHtml(html: string, originalUrl: string): Candidate[] {
  if (!html || typeof html !== 'string') {
    throw new DownloadError('DISCOVERY', '小红书页面数据为空');
  }

  const state = extractHtmlState(html, /window\.__INITIAL_STATE__\s*=\s*({.+?});?<\/script>/s);
  if (!state) {
    throw new DownloadError('DISCOVERY', '未能从小红书页面读取数据，可能触发了平台反爬验证');
  }

  // 寻找 note 实体
  let note: any = null;
  if (state.note?.noteDetailMap) {
    const map = state.note.noteDetailMap;
    const keys = Object.keys(map);
    if (keys.length > 0) {
      note = map[keys[0]]?.note || map[keys[0]];
    }
  }
  if (!note && state.note?.firstNote) {
    note = state.note.firstNote;
  }

  if (!note) {
    throw new DownloadError('DISCOVERY', '未找到小红书笔记详情，内容可能已被删除或设为私密');
  }

  // 纯图文笔记检查
  if (note.type === 'normal' || (!note.video && Array.isArray(note.imageList) && note.imageList.length > 0)) {
    throw new DownloadError('DISCOVERY', '该小红书笔记为图文内容，未包含视频');
  }

  const video = note.video;
  if (!video) {
    throw new DownloadError('DISCOVERY', '该小红书笔记未包含可下载的视频');
  }

  // 提取视频地址流
  const streams = video.media?.stream?.h264 || video.media?.stream?.h265 || [];
  let videoUrl: string | undefined;

  if (Array.isArray(streams) && streams.length > 0) {
    // 优先最高码率
    const sorted = [...streams].sort((a: any, b: any) => (b.videoBitrate || b.avgBitrate || 0) - (a.videoBitrate || a.avgBitrate || 0));
    videoUrl = sorted[0]?.masterUrl || sorted[0]?.backupUrls?.[0];
  }

  if (!videoUrl && typeof video.consumer?.originVideoKey === 'string') {
    videoUrl = `https://sns-video-bd.xhscdn.com/${video.consumer.originVideoKey}`;
  }

  if (!videoUrl) {
    throw new DownloadError('DISCOVERY', '未找到小红书视频播放地址');
  }

  const titleText = note.title || note.desc || '小红书视频';
  const author = note.user?.nickname ? `${note.user.nickname}: ` : '';
  const title = cleanTitle(`${author}${titleText}`);

  return [{
    id: randomUUID(),
    title,
    url: videoUrl,
    source: originalUrl,
    kind: 'mp4',
    quality: '高清无水印',
    context: XHS_CONTEXT
  }];
}
