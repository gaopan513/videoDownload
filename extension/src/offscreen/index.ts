import type { VideoCandidate } from '../shared/types';
import { validateDirectResponse } from '../core/media';
import { formatBytes } from '../core/utils';
import { fetchHls, controlHls } from './hls';

interface BufferState {
  chunks: Uint8Array<ArrayBuffer>[];
  received: number;
  expected: number;
  encoding: string;
  validator?: string;
  prefix: Uint8Array<ArrayBuffer>;
  prefixSize: number;
  checked: boolean;
  paused: boolean;
  cancelled: boolean;
  controller: AbortController;
}
const buffers = new Map<string, BufferState>();
function freshState(): BufferState {
  return { chunks: [], received: 0, expected: 0, encoding: 'identity', prefix: new Uint8Array(512), prefixSize: 0,
    checked: false, paused: false, cancelled: false, controller: new AbortController() };
}

async function fetchVideo(candidate: VideoCandidate, runId: string, resume = false) {
  const previous = resume ? buffers.get(candidate.id) : undefined;
  let state = previous ? { ...previous, controller: new AbortController() } : freshState();
  state.paused = false;
  state.cancelled = false;
  state.controller = new AbortController();
  buffers.set(candidate.id, state);
  // Only splice bytes when If-Range can prove that the representation is unchanged.
  let offset = state.encoding === 'identity' && state.validator && state.expected ? state.received : 0;
  if (offset && offset === state.expected && state.checked) {
    buffers.delete(candidate.id);
    return { url: URL.createObjectURL(new Blob(state.chunks, { type: candidate.kind === 'webm' ? 'video/webm' : 'video/mp4' })),
      diagnostics: { receivedBytes: state.received, declaredLength: state.expected, capturedSize: candidate.size, encoding: state.encoding, status: 200, expectedBytes: state.expected } };
  }
  if (!offset && state.received) {
    state = freshState(); buffers.set(candidate.id, state);
    await chrome.runtime.sendMessage({ type: 'BUFFERED_PROGRESS', taskId: candidate.id, runId, percentage: 0, notice: '此服务器无法安全续传，已从头获取视频' });
  }
  let reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | undefined;
  try {
    const headers: Record<string, string> = offset ? { Range: `bytes=${offset}-`, 'If-Range': state.validator! } : {};
    const response = await fetch(candidate.url, { credentials: 'include', cache: 'no-store', headers, signal: state.controller.signal });
    if (state.paused || state.cancelled) { await response.body?.cancel(); return { paused: state.paused, cancelled: state.cancelled }; }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`视频下载失败 HTTP ${response.status}`); }
    if (offset && response.status !== 206) {
      if (response.status !== 200) { await response.body?.cancel(); throw new Error('服务器无法继续此下载，请重试'); }
      const controller = state.controller;
      state = freshState(); state.controller = controller; buffers.set(candidate.id, state); offset = 0;
      await chrome.runtime.sendMessage({ type: 'BUFFERED_PROGRESS', taskId: candidate.id, runId, percentage: 0, notice: '文件已变化或服务器不支持续传，已重新下载' });
    }
    const encoding = response.headers.get('content-encoding')?.trim().toLowerCase() || 'identity';
    const declaredLength = Number(response.headers.get('content-length')) || 0;
    const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
    const rangeTotal = response.status === 206 && range ? Number(range[3]) : 0;
    const validator = response.headers.get('etag')?.match(/^".*"$/)?.[0] || response.headers.get('last-modified') || undefined;
    if (response.status === 206 && (!range || Number(range[1]) !== offset || Number(range[2]) + 1 !== rangeTotal)) {
      await response.body?.cancel(); throw new Error('服务器仅返回部分视频，已停止保存不完整文件');
    }
    if (offset && (encoding !== 'identity' || rangeTotal !== state.expected || validator !== state.validator)) {
      await response.body?.cancel(); throw new Error('续传文件内容或大小已变化，请重试完整下载');
    }
    // Content-Length describes encoded bytes; captured size is only a progress estimate.
    state.expected = encoding === 'identity' ? rangeTotal || declaredLength : 0;
    state.encoding = encoding; state.validator = validator;
    const total = state.expected || candidate.size || 0;
    reader = response.body?.getReader();
    if (!reader) throw new Error('视频响应为空');
    let lastUpdate = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (state.paused || state.cancelled) return { paused: state.paused, cancelled: state.cancelled };
      if (done) break;
      if (state.prefixSize < state.prefix.length) {
        const slice = value.subarray(0, state.prefix.length - state.prefixSize);
        state.prefix.set(slice, state.prefixSize); state.prefixSize += slice.length;
      }
      if (!state.checked && state.prefixSize >= 8) {
        validateDirectResponse(response.headers.get('content-type') || '', state.prefix.subarray(0, state.prefixSize), candidate.kind);
        state.checked = true;
      }
      state.chunks.push(value); state.received += value.length;
      if (Date.now() - lastUpdate > 500) {
        lastUpdate = Date.now();
        await chrome.runtime.sendMessage({ type: 'BUFFERED_PROGRESS', taskId: candidate.id, runId, percentage: total ? Math.floor(state.received / total * 99) : 0 });
      }
    }
    if (!state.checked) validateDirectResponse(response.headers.get('content-type') || '', state.prefix.subarray(0, state.prefixSize), candidate.kind);
    if (state.expected && state.received !== state.expected) throw new Error(`视频响应长度不符：收到 ${formatBytes(state.received)}，本次响应应为 ${formatBytes(state.expected)}（HTTP ${response.status}，编码 ${encoding}）`);
    const url = URL.createObjectURL(new Blob(state.chunks, { type: candidate.kind === 'webm' ? 'video/webm' : 'video/mp4' }));
    buffers.delete(candidate.id);
    return { url, diagnostics: { receivedBytes: state.received, declaredLength, capturedSize: candidate.size, encoding, status: response.status, expectedBytes: state.expected } };
  } catch (error) {
    if (state.paused || state.cancelled) return { paused: state.paused, cancelled: state.cancelled };
    buffers.delete(candidate.id); state.chunks = [];
    throw error;
  } finally { await reader?.cancel().catch(() => {}); }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;
  if (message.type === 'RELEASE_BLOB') { URL.revokeObjectURL(message.url); sendResponse({ ok: true }); return false; }
  if (message.type === 'CONTROL_BUFFER') {
    controlHls(message.taskId, message.action);
    const state = buffers.get(message.taskId);
    if (state) {
      if (message.action === 'pause') state.paused = true;
      else { state.cancelled = true; state.chunks = []; buffers.delete(message.taskId); }
      state.controller.abort();
    }
    sendResponse({ ok: true }); return false;
  }
  if (message.type === 'FETCH_VIDEO') {
    const fetchTask = message.candidate.kind === 'hls' ? fetchHls : fetchVideo;
    void fetchTask(message.candidate, message.runId, message.resume).then(
      result => chrome.runtime.sendMessage({ type: 'BUFFERED_RESULT', taskId: message.candidate.id, runId: message.runId, result }),
      error => chrome.runtime.sendMessage({ type: 'BUFFERED_RESULT', taskId: message.candidate.id, runId: message.runId, result: { error: error.message || String(error) } })
    ).catch(console.error);
    sendResponse({ accepted: true });
    return false;
  }
  return false;
});
