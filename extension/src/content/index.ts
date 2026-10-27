import type { VideoCandidate } from '../shared/types';
import { cleanTitle } from '../core/utils';
import { mediaKind } from '../core/media';
import { discoverPlayerMedia } from '../core/player-media';
import { discoverMetaDocument, metaPlatform } from '../core/meta-media';

// 记录已检测的 URL 防止频繁发送
const detectedUrls = new Set<string>();
let scannedPageUrl = location.href;

function inspectVideoElement(video: HTMLVideoElement) {
  // Meta blob players and CDN requests may be video-only DASH tracks. Use progressive metadata.
  if (metaPlatform(location.href)) return;
  const src = video.currentSrc || video.src;
  if (!src || src.startsWith('blob:') || detectedUrls.has(src)) return;

  detectedUrls.add(src);
  const title = cleanTitle(document.title || '网页视频');
  const kind = mediaKind(src) || 'unknown';

  const candidate: VideoCandidate = {
    id: `dom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    url: src,
    title,
    sourceUrl: window.location.href,
    kind,
    capturedAt: Date.now()
  };

  chrome.runtime.sendMessage({
    type: 'CANDIDATE_DETECTED_FROM_DOM',
    candidate
  }).catch(() => {
    // 忽略消息发送失败（例如插件重载后上下文失效）
  });
}

function scanMediaElements() {
  if (scannedPageUrl !== location.href) { detectedUrls.clear(); scannedPageUrl = location.href; }
  const meta = discoverMetaDocument(document, location.href);
  for (const candidate of meta.candidates) {
    if (detectedUrls.has(candidate.url)) continue;
    detectedUrls.add(candidate.url);
    void chrome.runtime.sendMessage({ type: 'CANDIDATE_DETECTED_FROM_DOM', candidate }).catch(() => {});
  }
  if (meta.dashOnly) void chrome.runtime.sendMessage({ type: 'META_MEDIA_STATUS', pageUrl: location.href, dashOnly: true }).catch(() => {});
  for (const candidate of discoverPlayerMedia(document, location.href)) {
    if (detectedUrls.has(candidate.url)) continue;
    detectedUrls.add(candidate.url);
    void chrome.runtime.sendMessage({ type: 'CANDIDATE_DETECTED_FROM_DOM', candidate }).catch(() => {});
  }
  const videos = document.querySelectorAll('video');
  videos.forEach(v => inspectVideoElement(v));

  const sources = document.querySelectorAll('video > source');
  sources.forEach(s => {
    const src = (s as HTMLSourceElement).src;
    if (src && !detectedUrls.has(src)) {
      const video = s.closest('video');
      if (video) inspectVideoElement(video);
    }
  });
}

// 首次加载扫描
scanMediaElements();

// 使用 MutationObserver 监听动态插入的 video 节点
let scanTimer: ReturnType<typeof setTimeout> | undefined;
const observer = new MutationObserver(() => {
  if (!scanTimer) scanTimer = setTimeout(() => { scanTimer = undefined; scanMediaElements(); }, 150);
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});
// currentSrc changes do not necessarily insert DOM nodes.
document.addEventListener('loadedmetadata', () => scanMediaElements(), true);
