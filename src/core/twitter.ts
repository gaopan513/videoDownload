import { randomUUID } from 'node:crypto';
import { DownloadError } from './net';
import type { Candidate, Context } from '../shared';

const TWITTER_HOST_PATTERN = /(?:^|\.)(?:twitter\.com|x\.com|vxtwitter\.com|fxtwitter\.com|fixupx\.com)$/i;

export const TWITTER_CONTEXT: Context = {
  origin: 'https://twitter.com',
  headers: {
    referer: 'https://twitter.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  },
  cookies: []
};

export function parseTweetId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!TWITTER_HOST_PATTERN.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/(?:^|\/)(?:[A-Za-z0-9_]+|i(?:\/web)?)\/status(?:es)?\/(\d+)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function isTwitterUrl(url: string): boolean {
  return parseTweetId(url) !== null;
}

export function calculateSyndicationToken(tweetId: string): string {
  try {
    const num = Number(tweetId);
    return Number.isFinite(num)
      ? ((num / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '')
      : '1';
  } catch {
    return '1';
  }
}

export function buildSyndicationUrl(tweetId: string): string {
  const token = calculateSyndicationToken(tweetId);
  return `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=${token}`;
}

export function buildFxTwitterUrl(tweetId: string): string {
  return `https://api.fxtwitter.com/status/${tweetId}`;
}

function cleanTitle(authorName: string, screenName: string, text: string, index = 0, total = 1): string {
  const author = authorName ? (screenName ? `${authorName} (@${screenName})` : authorName) : (screenName ? `@${screenName}` : 'Twitter 视频');
  const cleanText = (text || '')
    .replace(/https:\/\/t\.co\/\S+/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const prefix = total > 1 ? `[${index + 1}/${total}] ` : '';
  const summary = cleanText ? `: ${cleanText.slice(0, 70)}` : ' 的视频';
  return `${prefix}${author}${summary}`;
}

function parseResolution(url: string, bitrate?: number): { quality: string; score: number } {
  const resMatch = url.match(/\/(\d+)x(\d+)\//);
  const height = resMatch ? Math.min(Number(resMatch[1]), Number(resMatch[2])) : 0;
  const kbps = bitrate ? Math.round(bitrate / 1000) : 0;
  const score = bitrate || (height ? height * 1000 : 0);
  const quality = height && kbps
    ? `${height}p (${kbps} kbps)`
    : height
      ? `${height}p`
      : kbps
        ? `${kbps} kbps`
        : '默认画质';
  return { quality, score };
}

function extractVideoItems(item: any): any[] {
  const list: any[] = [];
  if (Array.isArray(item?.mediaDetails)) {
    for (const m of item.mediaDetails) {
      if (m.type === 'video' || m.type === 'animated_gif') list.push(m);
    }
  }
  if (!list.length && item?.video) {
    list.push({ type: 'video', video_info: item.video });
  }
  return list;
}

export function parseSyndicationResponse(data: any, originalUrl: string): Candidate[] {
  if (!data || typeof data !== 'object') {
    throw new DownloadError('DISCOVERY', '推文数据格式无法识别');
  }
  if (data.tombstone) {
    const reason = data.tombstone.text?.text || '推文不存在或已被作者删除';
    throw new DownloadError('DISCOVERY', reason);
  }

  let tweet = data;
  let mediaList = extractVideoItems(data);
  if (!mediaList.length && data.quoted_tweet) {
    const quotedList = extractVideoItems(data.quoted_tweet);
    if (quotedList.length) {
      tweet = data.quoted_tweet;
      mediaList = quotedList;
    }
  }

  if (!mediaList.length) {
    throw new DownloadError('DISCOVERY', '该推文未包含任何视频或动图内容');
  }

  const authorName = tweet.user?.name || data.user?.name || '';
  const screenName = tweet.user?.screen_name || data.user?.screen_name || '';
  const tweetText = tweet.text || data.text || '';

  const candidates: Candidate[] = [];

  for (let i = 0; i < mediaList.length; i++) {
    const item = mediaList[i];
    const isGif = item.type === 'animated_gif';
    const rawTitle = cleanTitle(authorName, screenName, tweetText, i, mediaList.length);
    const title = isGif ? `${rawTitle} (GIF)` : rawTitle;

    const variants: any[] = item.video_info?.variants || item.video?.variants || [];
    const mp4Variants = variants
      .filter((v: any) => v && (v.url || v.src) && (/video\/mp4/i.test(v.content_type || v.type || '') || /\.mp4($|\?)/i.test(v.url || v.src)))
      .map((v: any) => {
        const url = v.url || v.src;
        const bitrate = v.bitrate;
        const { quality, score } = parseResolution(url, bitrate);
        return { url, quality: isGif ? 'GIF 动图' : quality, score };
      })
      .sort((a, b) => b.score - a.score);

    const seenUrls = new Set<string>();
    for (const v of mp4Variants) {
      if (seenUrls.has(v.url)) continue;
      seenUrls.add(v.url);
      candidates.push({
        id: randomUUID(),
        title,
        url: v.url,
        source: originalUrl,
        kind: 'mp4',
        quality: v.quality,
        context: TWITTER_CONTEXT
      });
    }
  }

  if (!candidates.length) {
    throw new DownloadError('DISCOVERY', '未找到可提取的 Twitter 视频流地址');
  }

  return candidates;
}

export function parseFxTwitterResponse(data: any, originalUrl: string): Candidate[] {
  if (!data || data.code !== 200 || !data.tweet) {
    if (data?.code === 404) throw new DownloadError('DISCOVERY', '推文不存在或已被作者删除');
    throw new DownloadError('DISCOVERY', '无法从备用接口读取推文内容');
  }

  const tweet = data.tweet;
  const mediaItems: any[] = [];
  if (Array.isArray(tweet.media?.videos)) {
    mediaItems.push(...tweet.media.videos);
  }
  if (!mediaItems.length && Array.isArray(tweet.media?.all)) {
    for (const item of tweet.media.all) {
      if (item.type === 'video' || item.type === 'gif') mediaItems.push(item);
    }
  }

  if (!mediaItems.length) {
    throw new DownloadError('DISCOVERY', '该推文未包含任何视频或动图内容');
  }

  const authorName = tweet.author?.name || '';
  const screenName = tweet.author?.screen_name || '';
  const tweetText = tweet.text || '';

  const candidates: Candidate[] = [];
  for (let i = 0; i < mediaItems.length; i++) {
    const item = mediaItems[i];
    const isGif = item.type === 'gif';
    const rawTitle = cleanTitle(authorName, screenName, tweetText, i, mediaItems.length);
    const title = isGif ? `${rawTitle} (GIF)` : rawTitle;
    const quality = isGif ? 'GIF 动图' : item.height ? `${item.height}p` : 'MP4 默认画质';

    candidates.push({
      id: randomUUID(),
      title,
      url: item.url,
      source: originalUrl,
      kind: 'mp4',
      quality,
      context: TWITTER_CONTEXT
    });
  }

  return candidates;
}
