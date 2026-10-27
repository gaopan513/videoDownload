import type { VideoCandidate } from '../shared/types';
import { cleanTitle } from './utils';
import { mediaKind, requestUrl } from './media';

// Known player scripts use a JSON string for `main`. Read the literal without eval.
export function discoverPlayerMedia(doc: Document, pageUrl: string): VideoCandidate[] {
  const result: VideoCandidate[] = [];
  for (const script of Array.from(doc.scripts)) {
    const match = /\b(?:var|let|const)\s+main\s*=\s*("(?:\\.|[^"\\])*")/.exec(script.textContent || '');
    if (!match) continue;
    try {
      const url = requestUrl(new URL(JSON.parse(match[1]), pageUrl).href);
      const kind = mediaKind(url);
      if (!kind) continue;
      result.push({ id: `player_${crypto.randomUUID()}`, url, title: cleanTitle(doc.title), sourceUrl: pageUrl, headers: { Referer: pageUrl }, kind, capturedAt: Date.now(), playerConfig: true });
    } catch { /* Invalid literals or media URLs are not candidates. */ }
  }
  return result;
}
