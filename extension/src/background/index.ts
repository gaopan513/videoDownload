import type { VideoCandidate } from '../shared/types';
import { parseManifest } from '../core/hls';
import { mediaKind, requestUrl } from '../core/media';
import { startNativeDownload, getNativeTasks, updateBufferedProgress, controlNativeTask, handleBufferedResult, prepareHlsRequest, enqueueEpisodeRange, clearCompletedTasks } from './downloads';
import { pumpEpisodeQueue } from './batch';
import './badge';
import { metaPlatform, metaMediaUrl } from '../core/meta-media';
import { resolveMetaTab } from './meta';

const requestContexts = new Map<string, Record<string, string>>();
chrome.webRequest.onBeforeSendHeaders.addListener(details => {
  if (details.tabId < 0) return;
  const headers: Record<string, string> = {};
  for (const h of details.requestHeaders || []) {
    if (h.value && /^(referer|origin)$/i.test(h.name)) headers[h.name.toLowerCase() === 'referer' ? 'Referer' : 'Origin'] = h.value;
  }
  if (requestContexts.size >= 500) requestContexts.delete(requestContexts.keys().next().value!);
  requestContexts.set(details.requestId, headers);
}, { urls: ['<all_urls>'] }, ['requestHeaders', 'extraHeaders']);
chrome.webRequest.onCompleted.addListener(d => { requestContexts.delete(d.requestId); }, { urls: ['<all_urls>'] });
chrome.webRequest.onErrorOccurred.addListener(d => { requestContexts.delete(d.requestId); }, { urls: ['<all_urls>'] });

const tabCandidates = new Map<number, Map<string, VideoCandidate>>();
const invalidatedTabs = new Set<number>();
const tabMediaNotices = new Map<number, string>();
const restored = chrome.storage.session.get(['tabCandidates', 'tabMediaNotices']).then(data => {
  for (const [tabId, notice] of Object.entries(data.tabMediaNotices || {})) if (!invalidatedTabs.has(Number(tabId))) tabMediaNotices.set(Number(tabId), String(notice));
  for (const [tabId, candidates] of Object.entries(data.tabCandidates || {})) {
    const id = Number(tabId);
    if (invalidatedTabs.has(id)) continue;
    const pool = getTabPool(id);
    for (const candidate of candidates as VideoCandidate[]) if (!pool.has(candidate.url)) pool.set(candidate.url, candidate);
  }
});
function persistCandidates() {
  return restored.then(() => chrome.storage.session.set({ tabCandidates: Object.fromEntries(Array.from(tabCandidates, ([id, pool]) => [id, Array.from(pool.values())])), tabMediaNotices: Object.fromEntries(tabMediaNotices) }));
}

function getTabPool(tabId: number): Map<string, VideoCandidate> {
  let pool = tabCandidates.get(tabId);
  if (!pool) {
    pool = new Map();
    tabCandidates.set(tabId, pool);
  }
  return pool;
}

function candidateUrl(raw: string) {
  try { return requestUrl(raw); } catch { return raw; }
}

function updateBadge(tabId: number) {
  void persistCandidates();
}

// 检查 URL 或 Content-Type 是否为媒体资源

// 异步解析 M3U8 Master 获取清晰度详情
async function inspectHls(url: string): Promise<VideoCandidate['details']> {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const text = await res.text();
    const manifest = parseManifest(text, url);
    if (manifest.isMaster && manifest.playlists) {
      return {
        playlists: manifest.playlists.map(p => ({
          quality: p.quality,
          url: p.url,
          bandwidth: p.bandwidth
        }))
      };
    }
  } catch {
    // 忽略预检错误
  }
  return undefined;
}

// 监听网络请求完成事件，嗅探音视频流量
chrome.webRequest.onResponseStarted.addListener(
  async (details) => {
    // 忽略扩展自身请求和非活跃标签页（如 service worker 自身请求 tabId 为 -1）
    if (details.tabId <= 0) return;
    const headers = requestContexts.get(details.requestId);
    requestContexts.delete(details.requestId);
    await restored;
    if (details.statusCode < 200 || details.statusCode >= 300) return;

    let contentType = '';
    let contentLength = 0;
    let rangeTotal = 0;

    if (details.responseHeaders) {
      for (const h of details.responseHeaders) {
        const name = h.name.toLowerCase();
        if (name === 'content-type' && h.value) contentType = h.value;
        if (name === 'content-length' && h.value) {
          const parsedLen = parseInt(h.value, 10);
          if (!isNaN(parsedLen)) contentLength = parsedLen;
        }
        if (name === 'content-range' && h.value) {
          const total = h.value.match(/\/(\d+)$/)?.[1];
          if (total) rangeTotal = Number(total);
        }
      }
    }
    if (rangeTotal) contentLength = rangeTotal;

    const kind = mediaKind(details.url, contentType);
    if (!kind) return;

    // 过滤掉分片 TS 文件与太小的碎片（避免将单个切片当成主视频）
    if (details.url.includes('.ts') && !details.url.includes('.m3u8')) return;
    if (kind === 'mp4' && contentLength > 0 && contentLength < 100 * 1024) return; // 忽略 < 100KB 的广告片段/雪碧图

    const pool = getTabPool(details.tabId);
    const resourceUrl = candidateUrl(details.url);
    const existing = pool.get(resourceUrl);

    // 获取标签页标题
    let title = '在线视频';
    let pageUrl = existing?.sourceUrl || details.initiator || details.url;
    try {
      const tab = await chrome.tabs.get(details.tabId);
      if (tab?.title) title = tab.title;
      if (tab?.url) pageUrl = tab.url;
    } catch {
      // 忽略无法获取标签页的异常
    }

    // Meta CDN MP4 traffic may be an audio/video DASH track. Only use identified full media.
    if (metaPlatform(pageUrl)) return;

    const candidate: VideoCandidate = {
      id: existing?.id || `media_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      tabId: details.tabId,
      url: resourceUrl,
      title,
      sourceUrl: headers?.Referer || existing?.headers?.Referer || pageUrl,
      headers: { ...existing?.headers, ...headers },
      kind,
      size: contentLength > 0 ? contentLength : undefined,
      playerConfig: existing?.playerConfig,
      capturedAt: Date.now()
    };

    if (kind === 'hls') {
      inspectHls(details.url).then(det => {
        if (det) {
          candidate.details = det;
          updateBadge(details.tabId);
        }
      });
    }

    pool.set(resourceUrl, candidate);
    updateBadge(details.tabId);
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// 标签页关闭时清理池
chrome.tabs.onRemoved.addListener((tabId) => {
  invalidatedTabs.add(tabId);
  tabCandidates.delete(tabId);
  tabMediaNotices.delete(tabId);
  void persistCandidates();
});

// tabs.status may switch to loading for a late iframe; it is not a main-page navigation.
const tabPageUrls = new Map<number, string>();
function clearNavigatedTab(tabId: number) {
  invalidatedTabs.add(tabId);
  tabCandidates.delete(tabId);
  tabMediaNotices.delete(tabId);
  updateBadge(tabId);
}
chrome.webNavigation.onBeforeNavigate.addListener(details => {
  if (details.frameId === 0) clearNavigatedTab(details.tabId);
});
chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId !== 0) return;
  tabPageUrls.set(details.tabId, details.url);
  clearNavigatedTab(details.tabId);
});
chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
  if (details.frameId !== 0 || tabPageUrls.get(details.tabId) === details.url) return;
  tabPageUrls.set(details.tabId, details.url);
  clearNavigatedTab(details.tabId);
});
chrome.tabs.onRemoved.addListener(tabId => tabPageUrls.delete(tabId));

// 监听来自 Popup 或 Content Script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'offscreen') return false;
  if (message.type === 'RESOLVE_META_VIDEO') {
    resolveMetaTab(message.url).then(candidates => sendResponse({ candidates }), error => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message.type === 'META_MEDIA_STATUS') {
    const tabId = sender.tab?.id;
    if (tabId && sender.url === message.pageUrl && metaPlatform(message.pageUrl) && message.dashOnly === true) {
      tabMediaNotices.set(tabId, '此视频仅检测到 DASH 音视频分离流，当前扩展无法合并；可播放后重新捕获');
      void persistCandidates();
    }
    sendResponse({ ok: true }); return true;
  }
  if (message.type === 'CLEAR_COMPLETED_DOWNLOADS') {
    clearCompletedTasks().then(sendResponse, error => sendResponse({ error: String(error) }));
    return true;
  }
  if (message.type === 'ENQUEUE_EPISODE_RANGE') {
    Promise.resolve().then(() => enqueueEpisodeRange(message.firstUrl, message.lastUrl, message.title, message.selectedIds)).then(async result => { await pumpEpisodeQueue(); sendResponse(result); }).catch(error => sendResponse({ error: String(error) }));
    return true;
  }
  if (message.type === 'PREPARE_HLS_REQUEST') {
    prepareHlsRequest(message.taskId, message.runId, message.url).then(() => sendResponse({ ok: true }), error => sendResponse({ error: String(error) }));
    return true;
  }
  if (message.type === 'BUFFERED_RESULT') {
    handleBufferedResult(message.taskId, message.runId, message.result).then(() => sendResponse({ ok: true }), error => sendResponse({ error: String(error) }));
    return true;
  }
  if (message.type === 'BUFFERED_PROGRESS') {
    updateBufferedProgress(message.taskId, message.percentage, message.runId, message.notice).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'CONTROL_NATIVE_DOWNLOAD') {
    controlNativeTask(message.taskId, message.action).then(task => sendResponse({ task, ok: true }), error => sendResponse({ error: error.message || String(error) }));
    return true;
  }
  if (message.type === 'START_NATIVE_DOWNLOAD') {
    startNativeDownload(message.candidate).then(task => sendResponse({ task }), error => sendResponse({ error: String(error) }));
    return true;
  }
  if (message.type === 'GET_NATIVE_DOWNLOADS') {
    getNativeTasks().then(tasks => sendResponse({ tasks }), error => sendResponse({ error: String(error) }));
    return true;
  }
  if (message.type === 'GET_TAB_CANDIDATES') {
    void restored.then(() => {
    const tabId = message.tabId;
    const pool = tabCandidates.get(tabId);
    const candidates = pool ? Array.from(pool.values()) : [];
    sendResponse({ candidates, notice: candidates.length ? undefined : tabMediaNotices.get(tabId) });
    });
    return true;
  }

  if (message.type === 'CANDIDATE_DETECTED_FROM_DOM') {
    const tabId = sender.tab?.id;
    if (tabId && tabId > 0) {
      const pool = getTabPool(tabId);
      const c = message.candidate as VideoCandidate;
      if (c.platform && (metaPlatform(sender.url || '') !== c.platform || !metaMediaUrl(c.url))) {
        sendResponse({ ok: false }); return false;
      }
      const url = candidateUrl(c.url);
      if (!pool.has(url)) {
        pool.set(url, { ...c, url, tabId });
        updateBadge(tabId);
      } else if (c.playerConfig) {
        const current = pool.get(url)!;
        pool.set(url, { ...current, ...(c.platform ? { platform: c.platform, quality: c.quality, title: c.title } : {}), playerConfig: true, headers: { ...c.headers, ...current.headers } }); updateBadge(tabId);
      }
    }
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

void getNativeTasks().then(pumpEpisodeQueue).catch(console.error);
