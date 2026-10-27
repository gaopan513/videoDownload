import type { VideoCandidate } from '../shared/types';
import { resolveHlsSegments, decryptSegment, type HlsSegment } from '../core/hls';
import { pool } from '../core/utils';
import { normalizeTsSegment } from '../core/ts-segment';

interface HlsBuffer {
  segments?: HlsSegment[];
  chunks: (Uint8Array<ArrayBuffer> | undefined)[];
  removedPrefixBytes: number;
  normalizedSegments: number;
  controller: AbortController;
  paused: boolean;
  cancelled: boolean;
  settled: Promise<void>;
}
const buffers = new Map<string, HlsBuffer>();

export function controlHls(taskId: string, action: string) {
  const state = buffers.get(taskId);
  if (!state) return;
  if (action === 'pause') state.paused = true;
  else { state.cancelled = true; buffers.delete(taskId); }
  state.controller.abort();
}

export async function fetchHls(candidate: VideoCandidate, runId: string, resume = false) {
  const previous = buffers.get(candidate.id);
  if (previous) await previous.settled;
  const state: HlsBuffer = {
    segments: resume ? previous?.segments : undefined,
    chunks: resume ? previous?.chunks || [] : [],
    removedPrefixBytes: resume ? previous?.removedPrefixBytes || 0 : 0,
    normalizedSegments: resume ? previous?.normalizedSegments || 0 : 0,
    controller: new AbortController(), paused: false, cancelled: false, settled: Promise.resolve()
  };
  let settle!: () => void;
  state.settled = new Promise(resolve => { settle = resolve; });
  buffers.set(candidate.id, state);
  const signal = state.controller.signal;
  const fetchResource = async (rawUrl: string): Promise<Response> => {
    signal.throwIfAborted();
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('不支持的 HLS 资源协议');
    const result = await chrome.runtime.sendMessage({ type: 'PREPARE_HLS_REQUEST', taskId: candidate.id, runId, url: url.href });
    if (result?.error) throw new Error(result.error);
    signal.throwIfAborted();
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(url.href, { credentials: 'include', cache: 'no-store', signal });
        if (!response.ok) { await response.body?.cancel(); throw new Error(`HLS 请求失败 HTTP ${response.status}`); }
        return response;
      } catch (error) {
        if (signal.aborted || attempt === 3) throw error;
      }
    }
  };
  const progress = async () => {
    const completed = state.chunks.filter(Boolean).length;
    const total = state.segments?.length || 0;
    await chrome.runtime.sendMessage({ type: 'BUFFERED_PROGRESS', taskId: candidate.id, runId,
      percentage: total ? Math.min(99, Math.floor(completed / total * 99)) : 0,
      notice: total ? `已获取 ${completed}/${total} 个分片` : '解析 M3U8 播放列表' });
  };
  try {
    await progress();
    if (!state.segments) {
      state.segments = (await resolveHlsSegments(candidate.url, candidate.quality, fetchResource)).segments;
      state.chunks = new Array(state.segments.length);
    }
    if (!state.segments.length) throw new Error('未解析到可下载的媒体切片');
    const keyCache = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
    const getKey = (url: string) => {
      let key = keyCache.get(url);
      if (!key) {
        key = fetchResource(url).then(async response => {
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length !== 16) throw new Error('AES-128 密钥长度错误');
          return bytes;
        });
        keyCache.set(url, key);
      }
      return key;
    };
    await pool(state.segments, 6, async (segment, index) => {
      signal.throwIfAborted();
      if (state.chunks[index]) return;
      const response = await fetchResource(segment.url);
      if (/text\/html|application\/(?:json|xhtml)/i.test(response.headers.get('content-type') || '')) {
        await response.body?.cancel(); throw new Error('HLS 分片返回了网页，已停止保存');
      }
      let bytes = new Uint8Array(await response.arrayBuffer());
      if (segment.key?.uri && segment.key.iv) {
        const decrypted = await decryptSegment(bytes, await getKey(segment.key.uri), segment.key.iv);
        bytes = new Uint8Array(decrypted.buffer.slice(decrypted.byteOffset, decrypted.byteOffset + decrypted.byteLength) as ArrayBuffer);
      }
      signal.throwIfAborted();
      const normalized = normalizeTsSegment(bytes);
      state.chunks[index] = normalized.bytes;
      state.removedPrefixBytes += normalized.removedPrefixBytes;
      if (normalized.removedPrefixBytes) state.normalizedSegments++;
      await progress();
    });
    signal.throwIfAborted();
    const chunks = state.chunks as Uint8Array<ArrayBuffer>[];
    const receivedBytes = chunks.reduce((sum, bytes) => sum + bytes.length, 0);
    const url = URL.createObjectURL(new Blob(chunks, { type: 'video/mp2t' }));
    buffers.delete(candidate.id); state.chunks = [];
    return { url, diagnostics: { receivedBytes, totalSegments: state.segments.length, removedPrefixBytes: state.removedPrefixBytes, normalizedSegments: state.normalizedSegments } };
  } catch (error) {
    if (state.paused || state.cancelled) return { paused: state.paused, cancelled: state.cancelled };
    buffers.delete(candidate.id); state.chunks = []; throw error;
  } finally {
    if (state.cancelled) state.chunks = [];
    settle();
  }
}
