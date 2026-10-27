import type { SeriesEpisode } from '../shared/types';
import { mediaKind, requestUrl } from './media';

export function buildEpisodeRange(first: string, last: string) {
  const parse = (raw: string) => {
    let url: URL;
    try { url = new URL(requestUrl(raw.trim())); } catch { throw new Error('请输入完整的 HTTP/HTTPS 播放页链接'); }
    if (url.username || url.password) throw new Error('播放页链接不能包含用户名或密码');
    if (mediaKind(url.href)) throw new Error('请输入剧集播放页链接，不是 MP4/M3U8 视频直链');
    return url;
  };
  const start = parse(first); const end = parse(last);
  if (start.origin !== end.origin) throw new Error('第一集和最后一集必须来自同一网站');
  const startRoute = start.pathname + start.search; const endRoute = end.pathname + end.search;
  // Keep percent escapes literal: digits inside %xx are not episode numbers.
  const tokens = (route: string) => [...route.matchAll(/%[\da-f]{2}|\d+/gi)].filter(match => !match[0].startsWith('%'));
  const a = tokens(startRoute); const b = tokens(endRoute);
  const shape = (route: string, matches: RegExpMatchArray[]) => {
    let at = 0; const parts: string[] = [];
    for (const match of matches) { parts.push(route.slice(at, match.index)); at = match.index! + match[0].length; }
    parts.push(route.slice(at)); return JSON.stringify(parts);
  };
  if (!a.length || a.length !== b.length || shape(startRoute, a) !== shape(endRoute, b)) throw new Error('两个链接的结构必须相同，仅集数编号可以不同');
  const changed = a.map((match, index) => match[0] !== b[index][0] ? index : -1).filter(index => index >= 0);
  if (changed.length > 1) throw new Error('两个链接有多个数字不同，请使用同一作品、同一播放线路的首尾链接');
  const index = changed[0] ?? a.length - 1;
  const firstNumber = Number(a[index][0]); const lastNumber = Number(b[index][0]);
  if (!Number.isSafeInteger(firstNumber) || !Number.isSafeInteger(lastNumber)) throw new Error('集数编号过大');
  if (lastNumber < firstNumber) throw new Error('最后一集编号不能小于第一集编号');
  const count = lastNumber - firstNumber + 1;
  if (count > 2000) throw new Error('单次最多生成 2000 集，请缩小范围');
  const width = a[index][0].startsWith('0') ? a[index][0].length : 0;
  const prefix = startRoute.slice(0, a[index].index); const suffix = startRoute.slice(a[index].index! + a[index][0].length);
  const urlAt = (number: number) => start.origin + prefix + String(number).padStart(width, '0') + suffix;
  if (urlAt(lastNumber) !== end.href) throw new Error('首尾链接的编号补零格式不一致');
  const episodes: SeriesEpisode[] = Array.from({ length: count }, (_, offset) => ({ id: String(firstNumber + offset), name: `第 ${offset + 1} 集`, url: urlAt(firstNumber + offset) }));
  return { firstUrl: start.href, lastUrl: end.href, firstNumber, lastNumber, episodes };
}
