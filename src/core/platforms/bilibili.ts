import { randomUUID } from 'node:crypto';
import { DownloadError } from '../net';
import { cleanTitle } from '../utils';
import type { Candidate, Context } from '../../shared';

export const BILIBILI_CONTEXT: Context = {
  origin: 'https://www.bilibili.com',
  headers: {
    referer: 'https://www.bilibili.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  },
  cookies: []
};

const BVID_PATTERN = /[Bb][Vv][1-9A-HJ-NP-Za-km-z]{10}/;
const AVID_PATTERN = /[Aa][Vv](\d+)/;

export function isBilibiliUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === 'b23.tv' || host.endsWith('.b23.tv')) return true;
    if (host === 'bilibili.com' || host.endsWith('.bilibili.com')) {
      return BVID_PATTERN.test(parsed.pathname) || AVID_PATTERN.test(parsed.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

export function parseBilibiliId(url: string): { bvid?: string; aid?: string } | null {
  try {
    const parsed = new URL(url);
    const bvMatch = parsed.pathname.match(BVID_PATTERN);
    if (bvMatch) return { bvid: bvMatch[0] };
    const avMatch = parsed.pathname.match(AVID_PATTERN);
    if (avMatch) return { aid: avMatch[1] };
    return null;
  } catch {
    return null;
  }
}

export function buildBilibiliViewUrl(id: { bvid?: string; aid?: string }): string {
  if (id.bvid) return `https://api.bilibili.com/x/web-interface/view?bvid=${id.bvid}`;
  if (id.aid) return `https://api.bilibili.com/x/web-interface/view?aid=${id.aid}`;
  throw new DownloadError('URL', '无效的哔哩哔哩视频标识');
}

export function buildBilibiliPlayUrl(id: { bvid?: string; aid?: string }, cid: number | string): string {
  const base = 'https://api.bilibili.com/x/player/playurl';
  const param = id.bvid ? `bvid=${id.bvid}` : `aid=${id.aid}`;
  // qn=64 为 720P，fnval=1 为 MP4 格式直链（免登录最高标准）
  return `${base}?${param}&cid=${cid}&qn=64&fnval=1&fnver=0&fourk=1`;
}

const QUALITY_MAP: Record<number, string> = {
  127: '8K 超高清',
  120: '4K 超清',
  116: '1080P 60帧',
  112: '1080P 高码率',
  80: '1080P 高清',
  64: '720P 高清',
  32: '480P 清晰',
  16: '360P 流畅'
};

export function parseBilibiliResponse(viewData: any, playData: any, originalUrl: string): Candidate[] {
  if (!viewData || viewData.code !== 0 || !viewData.data) {
    const msg = viewData?.message || '视频不存在或已被作者删除';
    throw new DownloadError('DISCOVERY', `哔哩哔哩视频信息获取失败: ${msg}`);
  }

  const title = cleanTitle(viewData.data.title || '哔哩哔哩视频');
  if (!playData || playData.code !== 0 || !playData.data) {
    const msg = playData?.message || '无法获取视频播放地址';
    throw new DownloadError('DISCOVERY', `哔哩哔哩播放地址解析失败: ${msg}`);
  }

  const data = playData.data;
  const durl = data.durl;
  if (!Array.isArray(durl) || !durl.length || !durl[0]?.url) {
    throw new DownloadError('DISCOVERY', '未找到可直接下载的哔哩哔哩视频流');
  }

  const qualityCode = data.quality || 64;
  const quality = QUALITY_MAP[qualityCode] || `${qualityCode}P`;
  const candidates: Candidate[] = [];

  // 单个视频直链或分段
  candidates.push({
    id: randomUUID(),
    title,
    url: durl[0].url,
    source: originalUrl,
    kind: 'mp4',
    quality,
    context: BILIBILI_CONTEXT
  });

  return candidates;
}
