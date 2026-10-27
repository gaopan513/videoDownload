import type { VideoCandidate } from '../shared/types';

export function mediaKind(url: string, contentType = ''): VideoCandidate['kind'] | null {
  const mime = contentType.toLowerCase();
  if (/text\/html|application\/xhtml|application\/json/.test(mime)) return null;
  let path: string;
  try { path = new URL(url).pathname.toLowerCase(); } catch { return null; }
  if (mime.includes('mpegurl') || path.endsWith('.m3u8')) return 'hls';
  if (/video\/(mp4|x-m4v)/.test(mime) || /\.(mp4|m4v)$/.test(path)) return 'mp4';
  if (mime.includes('video/webm') || path.endsWith('.webm')) return 'webm';
  return null;
}

export function requestUrl(raw: string): string {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP/HTTPS 视频地址');
  url.hash = '';
  return url.href;
}

export function validateDirectResponse(mime: string, bytes: Uint8Array, kind: VideoCandidate['kind']) {
  const prefix = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart();
  if (/text\/html|application\/xhtml|application\/json/i.test(mime) || /^(?:<!doctype\s+html|<html|<head|<body|<script|\{)/i.test(prefix)) {
    throw new Error('视频地址返回了网页或错误信息，可能需要播放页来源、登录或重新捕获链接');
  }
  const mp4 = bytes.length >= 8 && new TextDecoder().decode(bytes.subarray(4, 8)) === 'ftyp';
  const webm = bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (!(kind === 'webm' ? webm : mp4)) throw new Error('响应内容不是有效的 MP4/WebM 文件，请重新播放并捕获视频');
}
