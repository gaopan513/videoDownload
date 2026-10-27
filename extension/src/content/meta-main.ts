import { extractMetaText, metaPlatform, META_CHANNEL, META_MAX_TEXT } from '../core/meta-media';

// Runs at document_start in MAIN only on Meta pages. Observe existing responses, no API requests.
const emit = (text: string, pageUrl: string) => {
  if (location.href !== pageUrl) return;
  const result = extractMetaText(text, pageUrl, document.title);
  if (result.candidates.length || result.dashOnly) window.postMessage({ channel: META_CHANNEL, pageUrl, ...result }, location.origin);
};
const relevant = (raw: string) => {
  try { return metaPlatform(new URL(raw, location.href).href) === metaPlatform(location.href); } catch { return false; }
};
const originalFetch = window.fetch;
window.fetch = function (...args) {
  const pageUrl = location.href;
  const promise = originalFetch.apply(this, args);
  void promise.then(async response => {
    if (!relevant(response.url) || !/json|javascript|text\/plain/i.test(response.headers.get('Content-Type') || '') || Number(response.headers.get('Content-Length')) > META_MAX_TEXT) return;
    const reader = response.clone().body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder(); let text = '', size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > META_MAX_TEXT) { void reader.cancel(); return; }
        text += decoder.decode(chunk.value, { stream: true });
      }
      emit(text + decoder.decode(), pageUrl);
    } finally { reader.releaseLock(); }
  }).catch(() => {});
  return promise;
};
const originalSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function (body) {
  const pageUrl = location.href;
  this.addEventListener('load', () => {
    try {
      if (relevant(this.responseURL) && /json|javascript|text\/plain/i.test(this.getResponseHeader('Content-Type') || '')) {
        if (this.responseType === 'json') emit(JSON.stringify(this.response), pageUrl);
        else if (this.responseType === '' || this.responseType === 'text') emit(this.responseText, pageUrl);
      }
    } catch { /* Site response not readable. */ }
  }, { once: true });
  return originalSend.call(this, body);
};
