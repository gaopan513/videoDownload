import { Parser } from 'm3u8-parser';
import { createDecipheriv } from 'node:crypto';
import { DownloadError } from './net';
export function parse(text: string) { if (!text.trimStart().startsWith('#EXTM3U')) throw new DownloadError('FORMAT', '响应不是有效的 M3U8 播放列表'); const p = new Parser(); p.push(text); p.end(); return p.manifest; }
export interface Segment { url: string; duration: number; sequence: number; discontinuity: boolean; epoch: number; range?: { offset: number; length: number }; key?: { url: string; iv: string }; map?: { url: string; range?: { offset: number; length: number }; key?: { url: string; iv: string } } }
function ivHex(iv: number[] | undefined, sequence: number) { return iv ? Array.from(iv).map(n => (n >>> 0).toString(16).padStart(8, '0')).join('') : BigInt(sequence).toString(16).padStart(32, '0'); }
export function segments(text: string, base: string): Segment[] {
  const m = parse(text); if (!m.endList) throw new DownloadError('LIVE', '首版仅支持完整视频，不支持直播或尚未结束的播放列表');
  if (!m.segments?.length) throw new DownloadError('FORMAT', '播放列表没有可下载分片');
  let epoch = 0; const epochs: number[] = [];
  for (const raw of text.split(/\r?\n/)) { const line = raw.trim(); if (line.startsWith('#EXT-X-KEY:')) epoch++; else if (line && !line.startsWith('#')) epochs.push(epoch); }
  return m.segments.map((s: any, i: number) => {
    const sequence = (m.mediaSequence || 0) + i;
    if (s.gap) throw new DownloadError('GAP', '播放列表包含缺失分片，无法生成完整视频');
    const key = (k: any, init = false) => {
      if (!k || k.method === 'NONE') return undefined;
      if (k.method !== 'AES-128' || (k.keyFormat && k.keyFormat !== 'identity')) throw new DownloadError('DRM', '不支持此加密方式或 DRM 保护资源');
      if (init && !k.iv) throw new DownloadError('KEY', '加密初始化片段缺少显式 IV');
      return { url: new URL(k.uri, base).href, iv: ivHex(k.iv, sequence) };
    };
    return { url: new URL(s.uri, base).href, duration: s.duration, sequence, discontinuity: !!s.discontinuity, epoch: epochs[i] || 0, range: s.byterange, key: key(s.key), map: s.map ? { url: new URL(s.map.uri, base).href, range: s.map.byterange, key: key(s.map.key, true) } : undefined };
  });
}
export function decrypt(data: Buffer, key: Buffer, iv: string) {
  if (key.length !== 16 || !/^[0-9a-f]{32}$/i.test(iv)) throw new DownloadError('KEY', 'AES-128 密钥或 IV 无效');
  try { const d = createDecipheriv('aes-128-cbc', key, Buffer.from(iv, 'hex')); return Buffer.concat([d.update(data), d.final()]); }
  catch { throw new DownloadError('KEY', '分片解密失败，密钥或媒体数据不匹配'); }
}
