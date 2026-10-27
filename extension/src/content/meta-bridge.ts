import { metaMediaUrl, metaPlatform, META_CHANNEL } from '../core/meta-media';
import { cleanTitle } from '../core/utils';

window.addEventListener('message', event => {
  const data = event.data;
  if (event.source !== window || event.origin !== location.origin || data?.channel !== META_CHANNEL || data.pageUrl !== location.href) return;
  const platform = metaPlatform(location.href);
  if (!platform) return;
  // MAIN messages are untrusted. Forward only CDN media and safe metadata, never raw response data.
  for (const candidate of Array.isArray(data.candidates) ? data.candidates.slice(0, 100) : []) {
    const url = metaMediaUrl(candidate?.url);
    if (!url) continue;
    void chrome.runtime.sendMessage({ type: 'CANDIDATE_DETECTED_FROM_DOM', candidate: {
      id: `meta_${crypto.randomUUID()}`, url, title: cleanTitle(typeof candidate.title === 'string' ? candidate.title : document.title), sourceUrl: location.href,
      headers: { Referer: location.href }, kind: 'mp4', quality: typeof candidate.quality === 'string' ? candidate.quality.slice(0, 80) : `${platform} MP4`, platform, playerConfig: true, capturedAt: Date.now()
    } }).catch(() => {});
  }
  if (data.dashOnly === true) void chrome.runtime.sendMessage({ type: 'META_MEDIA_STATUS', pageUrl: location.href, dashOnly: true }).catch(() => {});
});
