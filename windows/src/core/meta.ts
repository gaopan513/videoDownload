import * as cheerio from 'cheerio';
import { randomUUID } from 'node:crypto';
import { extractMetaText, isMetaVideoUrl, metaMediaUrl, metaPlatform, META_MAX_TEXT, type MetaMediaResult } from '../../../extension/src/core/meta-media';
import { cleanTitle } from '../../../extension/src/core/utils';
import type { Candidate, Context } from '../shared';

// One parser for the extension and desktop; bundling embeds it in the Windows app.
export { extractMetaText, isMetaVideoUrl, metaPlatform, META_MAX_TEXT };

export function extractMetaHtml(html: string, pageUrl: string): MetaMediaResult {
  const result: MetaMediaResult = { candidates: [], dashOnly: false };
  if (!isMetaVideoUrl(pageUrl) || html.length > META_MAX_TEXT) return result;
  const $ = cheerio.load(html), title = $('title').text();
  const seen = new Set<string>();
  $('script').each((_, el) => {
    const parsed = extractMetaText($(el).html() || '', pageUrl, title);
    result.dashOnly ||= parsed.dashOnly;
    for (const c of parsed.candidates) if (!seen.has(c.url) && seen.size < 100) { seen.add(c.url); result.candidates.push(c); }
  });
  $('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"]').each((_, el) => {
    const url = metaMediaUrl($(el).attr('content'));
    if (!url || seen.has(url) || seen.size >= 100) return;
    seen.add(url);
    result.candidates.push({ id: randomUUID(), url, sourceUrl: pageUrl, title: cleanTitle(title || `${metaPlatform(pageUrl)} 视频`), kind: 'mp4', quality: `${metaPlatform(pageUrl)} MP4`, platform: metaPlatform(pageUrl)!, capturedAt: Date.now() });
  });
  result.dashOnly &&= !result.candidates.length;
  return result;
}

export function desktopMetaCandidates(parsed: MetaMediaResult, source: string, context: Context): Candidate[] {
  return parsed.candidates.slice(0, 100).map(c => ({ id: randomUUID(), title: c.title, url: c.url, source, kind: 'mp4', quality: c.quality, context: { ...context, origin: c.url, headers: { ...context.headers, referer: c.sourceUrl } } }));
}
