import { Parser } from 'm3u8-parser';
import { retry } from './utils';

export interface HlsSegment {
  url: string;
  duration: number;
  sequence: number;
  key?: {
    method: string;
    uri: string;
    iv?: Uint8Array;
  };
}

export interface HlsPlaylist {
  quality: string;
  url: string;
  bandwidth?: number;
}

export interface HlsManifestResult {
  isMaster: boolean;
  playlists?: HlsPlaylist[];
  segments?: HlsSegment[];
}

export function parseManifest(manifestText: string, baseUrl: string): HlsManifestResult {
  if (!manifestText.trimStart().startsWith('#EXTM3U')) {
    throw new Error('响应不是有效的 M3U8 播放列表');
  }

  const parser = new Parser();
  parser.push(manifestText);
  parser.end();

  const manifest = parser.manifest;

  if (manifest.playlists && manifest.playlists.length > 0) {
    const playlists: HlsPlaylist[] = manifest.playlists.map((p: any) => {
      const res = p.attributes?.RESOLUTION;
      const quality = res ? `${res.height}p` : p.attributes?.BANDWIDTH ? `${Math.round(p.attributes.BANDWIDTH / 1000)} kbps` : '默认清晰度';
      return {
        quality,
        url: new URL(p.uri, baseUrl).href,
        bandwidth: p.attributes?.BANDWIDTH
      };
    });
    return { isMaster: true, playlists };
  }

  if (manifest.segments && manifest.segments.length > 0) {
    const mediaSequence = manifest.mediaSequence || 0;
    const segments: HlsSegment[] = manifest.segments.map((s: any, idx: number) => {
      const seq = mediaSequence + idx;
      let keyInfo: HlsSegment['key'] = undefined;
      if (s.key && s.key.method && s.key.method !== 'NONE') {
        let ivBytes: Uint8Array | undefined;
        if (s.key.iv) {
          ivBytes = new Uint8Array(16);
          const view = new DataView(ivBytes.buffer);
          Array.from(s.key.iv as Uint32Array).forEach((word, index) => view.setUint32(index * 4, word));
        } else {
          // 根据规范，缺失 IV 时使用分片 sequence 填充 16 字节
          const buffer = new ArrayBuffer(16);
          const view = new DataView(buffer);
          view.setBigUint64(8, BigInt(seq));
          ivBytes = new Uint8Array(buffer);
        }
        keyInfo = {
          method: s.key.method,
          uri: new URL(s.key.uri, baseUrl).href,
          iv: ivBytes
        };
      }
      if (s.map || s.byterange || (keyInfo && keyInfo.method !== 'AES-128')) {
        throw new Error('此 HLS 使用初始化片段、字节范围或不支持的加密，暂不能合并为 TS');
      }
      return {
        url: new URL(s.uri, baseUrl).href,
        duration: s.duration,
        sequence: seq,
        key: keyInfo
      };
    });
    return { isMaster: false, segments };
  }

  throw new Error('未解析到有效的播放列表或分片');
}

/**
 * 浏览器端使用 Web Crypto 原生 API 进行 AES-128-CBC 解密
 */
export async function decryptSegment(
  encryptedData: Uint8Array,
  keyData: Uint8Array,
  iv: Uint8Array
): Promise<Uint8Array> {
  // 转换成标准的 ArrayBuffer 以兼容 TS 强类型与 Web Crypto
  const keyBuffer = keyData.buffer.slice(keyData.byteOffset, keyData.byteOffset + keyData.byteLength) as ArrayBuffer;
  const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const dataBuffer = encryptedData.buffer.slice(encryptedData.byteOffset, encryptedData.byteOffset + encryptedData.byteLength) as ArrayBuffer;

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-CBC' },
    false,
    ['decrypt']
  );

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: ivBuffer },
    cryptoKey,
    dataBuffer
  );

  return new Uint8Array(decryptedBuffer);
}

/**
 * 解析并拉取 M3U8 最终分片列表（自动处理多级 Playlist 递归）
 */
export async function resolveHlsSegments(
  m3u8Url: string,
  preferredQuality?: string,
  fetchPlaylist: (url: string) => Promise<Response> = url => retry(() => fetch(url)),
  depth = 0
): Promise<{ segments: HlsSegment[]; playlists?: HlsPlaylist[] }> {
  if (depth > 8) throw new Error('播放列表嵌套过深');
  const res = await fetchPlaylist(m3u8Url);
  if (!res.ok) throw new Error(`拉取 m3u8 失败 HTTP ${res.status}`);
  const text = await res.text();
  const parsed = parseManifest(text, res.url || m3u8Url);

  if (parsed.isMaster && parsed.playlists && parsed.playlists.length > 0) {
    let target = parsed.playlists[0];
    if (preferredQuality) {
      const match = parsed.playlists.find(p => p.quality === preferredQuality);
      if (match) target = match;
    }
    // 递归获取子 playlist
    const subResult = await resolveHlsSegments(target.url, undefined, fetchPlaylist, depth + 1);
    return {
      segments: subResult.segments,
      playlists: parsed.playlists
    };
  }

  return {
    segments: parsed.segments || [],
    playlists: undefined
  };
}
