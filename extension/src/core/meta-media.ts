import type { VideoCandidate } from '../shared/types';
import { cleanTitle } from './utils';

export type MetaPlatform = 'Instagram' | 'Facebook';
export const META_CHANNEL = 'streamharbor-meta-media-v1';
export const META_MAX_TEXT = 8 * 1024 * 1024;

function domain(host: string, base: string) { return host === base || host.endsWith(`.${base}`); }

export function metaPlatform(raw: string): MetaPlatform | null {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (domain(url.hostname, 'instagram.com')) return 'Instagram';
    if (domain(url.hostname, 'facebook.com') || url.hostname === 'fb.watch') return 'Facebook';
  } catch { /* Invalid URL. */ }
  return null;
}

export function metaPostId(raw: string): string | undefined {
  const url = new URL(raw);
  if (metaPlatform(raw) === 'Instagram') return url.pathname.match(/\/(?:p|tv|reels?)\/([\w-]+)/)?.[1];
  return url.searchParams.get('v') || url.pathname.match(/\/(?:reel|videos)\/(?:[^/]+\/)?(\d+)/)?.[1];
}

export function isMetaVideoUrl(raw: string): boolean {
  if (!metaPlatform(raw)) return false;
  const url = new URL(raw);
  return Boolean(metaPostId(raw)) || url.hostname === 'fb.watch' || /^\/share\/(?:v|r|reel)\//.test(url.pathname);
}

// Preserve CDN signatures. Browser range query parameters must not turn a clip into a download.
export function metaMediaUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw.replace(/&amp;/g, '&'));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (!['cdninstagram.com', 'fbcdn.net', 'fbsbx.com'].some(base => domain(url.hostname, base))) return null;
    if (/\.(?:mpd|m3u8|m4s|ts|jpg|jpeg|png|webp)(?:$)/i.test(url.pathname)) return null;
    url.searchParams.delete('bytestart'); url.searchParams.delete('byteend'); url.hash = '';
    return url.href;
  } catch { return null; }
}

export interface MetaMediaResult { candidates: VideoCandidate[]; dashOnly: boolean; }

// Read only known progressive fields; arbitrary JSON URLs may be thumbnails or DASH segments.
export function extractMetaMedia(data: unknown, pageUrl: string, title = ''): MetaMediaResult {
  const platform = metaPlatform(pageUrl);
  const result: MetaMediaResult = { candidates: [], dashOnly: false };
  if (!platform || !isMetaVideoUrl(pageUrl)) return result;
  const target = metaPostId(pageUrl);
  const seen = new Set<unknown>(); const urls = new Set<string>();
  const add = (raw: unknown, label: string, name: string) => {
    const url = metaMediaUrl(raw);
    if (!url || urls.has(url) || result.candidates.length >= 100) return;
    urls.add(url);
    result.candidates.push({ id: `meta_${crypto.randomUUID()}`, url, title: cleanTitle(name || title || `${platform} 视频`), sourceUrl: pageUrl, headers: { Referer: pageUrl }, kind: 'mp4', quality: `${platform} ${label}`.trim(), playerConfig: true, platform, capturedAt: Date.now() });
  };
  let visited = 0;
  const walk = (value: unknown, inheritedTitle: string, depth: number, carousel = false) => {
    // Relay/ServerJS may carry its media result as a JSON string inside an outer JSON object.
    if (typeof value === 'string' && depth <= 70 && value.length <= META_MAX_TEXT && /^\s*[\[{]/.test(value) && /video_versions|video_url|playable_url|progressive_urls|dash_manifest|videoDelivery/.test(value)) {
      try { walk(JSON.parse(value), inheritedTitle, depth + 1, carousel); } catch { /* No eval or JavaScript parsing. */ }
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 70 || ++visited > 30000) return;
    seen.add(value);
    if (Array.isArray(value)) { for (const child of value) walk(child, inheritedTitle, depth + 1, carousel); return; }
    const node = value as Record<string, any>;
    const mediaNode = ['video_versions', 'video_url', 'carousel_media', 'edge_sidecar_to_children', 'playable_url', 'playable_url_quality_hd', 'browser_native_sd_url', 'browser_native_hd_url', 'hd_src', 'hd_src_no_ratelimit', 'sd_src', 'sd_src_no_ratelimit', 'progressive_urls', 'videoDeliveryLegacyFields', 'videoDeliveryResponseFragment', 'dash_manifest', 'video_dash_manifest', 'dash_manifest_urls', 'dash_manifests'].some(key => key in node) || node.__typename === 'Video';
    const identity = platform === 'Instagram' ? node.shortcode || node.code : node.videoId || node.id;
    if (target && !carousel && mediaNode && identity && String(identity) !== target) return;
    const name = typeof node.title === 'string' ? node.title : typeof node.name === 'string' ? node.name : node.caption?.text || inheritedTitle;
    if (node.dash_manifest || node.video_dash_manifest || node.dash_manifest_xml_string || node.dash_manifest_url || node.dash_manifest_urls || node.dash_manifests || node.playable_url_dash) result.dashOnly = true;
    if (platform === 'Instagram') {
      if (Array.isArray(node.video_versions)) for (const version of node.video_versions) add(version?.url, version?.height ? `${version.height}p` : 'MP4', name);
      add(node.video_url, node.dimensions?.height ? `${node.dimensions.height}p` : 'MP4', name);
    } else {
      for (const [key, quality] of [['browser_native_hd_url', 'HD'], ['playable_url_quality_hd', 'HD'], ['hd_src', 'HD'], ['hd_src_no_ratelimit', 'HD'], ['browser_native_sd_url', 'SD'], ['playable_url', 'SD'], ['sd_src', 'SD'], ['sd_src_no_ratelimit', 'SD']]) add(node[key], quality, name);
      if (Array.isArray(node.progressive_urls)) for (const version of node.progressive_urls) add(version?.progressive_url, version?.metadata?.quality || 'MP4', name);
    }
    for (const [key, child] of Object.entries(node)) walk(child, name, depth + 1, carousel || key === 'carousel_media' || key === 'edge_sidecar_to_children');
  };
  walk(data, title, 0);
  result.dashOnly = result.dashOnly && result.candidates.length === 0;
  return result;
}

// Meta returns JSON and newline-delimited Relay chunks, sometimes with an XSSI prefix.
export function extractMetaText(text: string, pageUrl: string, title = ''): MetaMediaResult {
  const result: MetaMediaResult = { candidates: [], dashOnly: false };
  if (text.length > META_MAX_TEXT) return result;
  const clean = text.trim().replace(/^(?:for\s*\(\s*;;\s*\)\s*;|\)\]\}',?\s*)/, '');
  const parts = [clean];
  if (clean.includes('\n')) parts.push(...clean.split('\n'));
  // Older pages assign JSON objects. Match balanced braces without executing site JavaScript.
  if (!clean.startsWith('{') && !clean.startsWith('[')) {
    for (const match of clean.matchAll(/(?:window\._sharedData\s*=|handleWithCustomApplyEach\s*\(|bigPipe\.onPageletArrive\s*\()\s*/g)) {
      const start = match.index! + match[0].length;
      let depth = 0, quoted = false, escaped = false;
      for (let i = start; i < clean.length; i++) {
        const c = clean[i];
        if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
        else if (c === '"') quoted = true;
        else if (c === '{' || c === '[') depth++;
        else if ((c === '}' || c === ']') && --depth === 0) { parts.push(clean.slice(start, i + 1)); break; }
      }
    }
  }
  const seen = new Set<string>();
  for (const part of parts) {
    try {
      const parsed = extractMetaMedia(JSON.parse(part), pageUrl, title);
      result.dashOnly ||= parsed.dashOnly;
      for (const candidate of parsed.candidates) if (!seen.has(candidate.url)) { seen.add(candidate.url); result.candidates.push(candidate); }
    } catch { /* JavaScript and incomplete chunks are not JSON. */ }
  }
  result.dashOnly &&= result.candidates.length === 0;
  return result;
}

export function discoverMetaDocument(doc: Document, pageUrl: string): MetaMediaResult {
  const result: MetaMediaResult = { candidates: [], dashOnly: false };
  if (!isMetaVideoUrl(pageUrl)) return result;
  const seen = new Set<string>();
  for (const script of Array.from(doc.scripts)) {
    const text = script.textContent || '';
    if (!/video_versions|video_url|playable_url|native_\w+_url|progressive_urls|dash_manifest|videoDelivery/.test(text)) continue;
    const parsed = extractMetaText(text, pageUrl, doc.title);
    result.dashOnly ||= parsed.dashOnly;
    for (const candidate of parsed.candidates) if (!seen.has(candidate.url)) { seen.add(candidate.url); result.candidates.push(candidate); }
  }
  for (const meta of Array.from(doc.querySelectorAll('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"]'))) {
    const url = metaMediaUrl(meta.getAttribute('content'));
    if (url && !seen.has(url)) {
      seen.add(url);
      result.candidates.push({ id: `meta_${crypto.randomUUID()}`, url, sourceUrl: pageUrl, title: cleanTitle(doc.title), headers: { Referer: pageUrl }, kind: 'mp4', quality: `${metaPlatform(pageUrl)} MP4`, platform: metaPlatform(pageUrl)!, playerConfig: true, capturedAt: Date.now() });
    }
  }
  result.dashOnly &&= result.candidates.length === 0;
  return result;
}
