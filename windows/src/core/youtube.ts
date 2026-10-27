import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DownloadError } from './net';
import type { Candidate, Context } from '../shared';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export const YOUTUBE_CONTEXT: Context = {
  origin: 'https://www.youtube.com',
  headers: {
    referer: 'https://www.youtube.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  },
  cookies: []
};

/** 解析 YouTube 视频 ID，兼容 watch / youtu.be / shorts / embed / live / 无协议粘贴。 */
export function parseYoutubeId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    try {
      url = new URL('https://' + raw.trim());
    } catch {
      return null;
    }
  }
  const host = url.hostname.toLowerCase();
  const isYoutube = host === 'youtu.be' || /(?:^|\.)youtube\.com$/.test(host) || /(?:^|\.)youtube-nocookie\.com$/.test(host);
  if (!isYoutube) return null;

  let id: string | undefined;
  if (host === 'youtu.be') {
    id = url.pathname.split('/').filter(Boolean)[0];
  } else {
    const v = url.searchParams.get('v');
    if (v) id = v;
    const m = url.pathname.match(/\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
    if (m) id = m[1];
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

export function isYoutubeUrl(url: string): boolean {
  return parseYoutubeId(url) !== null;
}

/** 丢弃 t / si / list 等无关参数，统一为 watch 标准链接作为解析入口。 */
export function normalizeYoutubeUrl(raw: string): string {
  const id = parseYoutubeId(raw);
  if (!id) throw new DownloadError('URL', '未识别到有效的 YouTube 视频 ID');
  return `https://www.youtube.com/watch?v=${id}`;
}

export function resolveYtDlpBundlePath(isPackaged: boolean, appPath: string, resourcesPath: string): string {
  return isPackaged
    ? path.join(resourcesPath, 'bin/yt-dlp.exe')
    : path.join(appPath, 'build/yt-dlp.exe');
}

/** yt-dlp 对 socks5h 无专门 scheme，统一为 socks5（远端解析由代理处理）。 */
export function proxyToYtDlp(proxy: string): string {
  return proxy.replace(/^socks5h:/i, 'socks5:');
}

/**
 * 动态格式选择器：优先 MP4 通用组合（avc1 视频 + mp4a 音频，走 https 直链），
 * 在选定高度内回退编码与 progressive；未指定高度时保留自动清晰度策略。
 */
export function buildYoutubeSelector(height?: number): string {
  const cap = height && height > 0 ? `[height=${Math.floor(height)}]` : '';
  return [
    `bestvideo${cap}[vcodec^=avc1][protocol^=http]+bestaudio[acodec^=mp4a][protocol^=http]`,
    `bestvideo${cap}[vcodec^=avc1][protocol^=http]+bestaudio[protocol^=http]`,
    `bestvideo${cap}[protocol^=http]+bestaudio[protocol^=http]`,
    `best${cap}[protocol^=http]`,
    `best${cap}`,
    ...(cap ? [] : ['best'])
  ].join('/');
}

/** 解析 --dump-single-json 结果，按真实可用高度去重生成清晰度候选。 */
export function parseYoutubeMeta(data: any, source: string): Candidate[] {
  if (!data || typeof data !== 'object') {
    throw new DownloadError('DISCOVERY', 'YouTube 返回的数据格式无法识别');
  }
  const formats: any[] = Array.isArray(data.formats) ? data.formats : [];
  const byHeight = new Map<number, { fps: number; avc: boolean }>();
  for (const f of formats) {
    const isVideoOnly = f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none');
    if (!isVideoOnly) continue;
    const h = Number(f.height);
    if (!h) continue;
    const fps = Number(f.fps) || 0;
    const prev = byHeight.get(h);
    if (prev) {
      prev.avc = prev.avc || /^avc1/i.test(f.vcodec || '');
      prev.fps = Math.max(prev.fps, fps);
    } else {
      byHeight.set(h, { fps, avc: /^avc1/i.test(f.vcodec || '') });
    }
  }

  const heights = [...byHeight.keys()].sort((a, b) => b - a);
  if (!heights.length) {
    throw new DownloadError('DISCOVERY', '未发现可下载的 YouTube 视频流，可能是直播或受限内容');
  }

  const title = String(data.title || 'YouTube 视频').replace(/[\x00-\x1f]+/g, ' ').trim() || 'YouTube 视频';
  const watch = normalizeYoutubeUrl(source);
  return heights.map(h => {
    const info = byHeight.get(h)!;
    const fpsLabel = info.fps >= 40 ? String(Math.round(info.fps)) : '';
    return {
      id: randomUUID(),
      title,
      url: watch,
      source,
      kind: 'youtube' as const,
      quality: `${h}p${fpsLabel}`,
      ytHeight: h,
      context: YOUTUBE_CONTEXT
    };
  });
}

/** 解析一行 --progress-template "%(progress)j" 输出，按 filename 区分视频/音频流。 */
export function parseYoutubeProgress(line: string): { key: string; done: number; total: number } | null {
  const text = line.trim();
  if (!text.startsWith('{') || !text.includes('"status"')) return null;
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (j.status !== 'downloading' && j.status !== 'finished') return null;
  const done = Number(j.downloaded_bytes);
  if (!Number.isFinite(done)) return null;
  const total = Number(j.total_bytes ?? j.total_bytes_estimate ?? 0);
  const key = String(j.filename || (j.info && j.info.format_id) || 'main');
  return { key, done, total: Number.isFinite(total) ? total : 0 };
}
