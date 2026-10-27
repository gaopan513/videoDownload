import { cleanTitle, retry } from './utils';
import type { VideoCandidate } from '../shared/types';
import { metaPlatform, isMetaVideoUrl } from './meta-media';

// Bilibili
const BVID_PATTERN = /[Bb][Vv][1-9A-HJ-NP-Za-km-z]{10}/;
const AVID_PATTERN = /[Aa][Vv](\d+)/;

export function isBilibiliUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === 'b23.tv' || host.endsWith('.b23.tv')) return true;
    if (host === 'bilibili.com' || host.endsWith('.bilibili.com')) {
      return BVID_PATTERN.test(parsed.pathname) || AVID_PATTERN.test(parsed.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

export async function resolveBilibili(url: string): Promise<VideoCandidate[]> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('无效的 URL 地址');
  }
  const bvMatch = parsed.pathname.match(BVID_PATTERN);
  const avMatch = parsed.pathname.match(AVID_PATTERN);
  if (!bvMatch && !avMatch) throw new Error('无效的哔哩哔哩链接');

  const param = bvMatch ? `bvid=${bvMatch[0]}` : `aid=${avMatch![1]}`;
  const viewRes = await retry(() => fetch(`https://api.bilibili.com/x/web-interface/view?${param}`));
  const viewJson = await viewRes.json();
  if (viewJson.code !== 0 || !viewJson.data) throw new Error(viewJson.message || '获取B站视频信息失败');

  const cid = viewJson.data.cid;
  const title = cleanTitle(viewJson.data.title || 'bilibili_video');

  // 获取 MP4 720P 直链
  const playRes = await retry(() => fetch(`https://api.bilibili.com/x/player/playurl?${param}&cid=${cid}&qn=64&fnval=1&fnver=0&fourk=1`));
  const playJson = await playRes.json();
  const durl = playJson?.data?.durl;
  if (!durl || !durl.length) throw new Error('未获取到B站可播放直链');

  return durl.map((item: any, idx: number) => ({
    id: `bilibili_${cid}_${idx}`,
    url: item.url,
    title: durl.length > 1 ? `${title}_P${idx + 1}` : title,
    sourceUrl: url,
    kind: 'mp4',
    quality: '720P / 高清',
    size: item.size,
    capturedAt: Date.now()
  }));
}

// 统一平台解析调度入口
export async function resolvePlatform(url: string): Promise<VideoCandidate[] | null> {
  if (metaPlatform(url)) {
    if (!isMetaVideoUrl(url)) throw new Error('请填写 Instagram 视频帖/Reel 或 Facebook 视频/Watch/Reel 的链接，主页与纯图片不支持视频解析');
    const response = await chrome.runtime.sendMessage({ type: 'RESOLVE_META_VIDEO', url });
    if (response?.error) throw new Error(response.error);
    if (!response?.candidates?.length) throw new Error('平台未返回可下载的视频，请打开视频页播放后重新捕获');
    return response.candidates;
  }
  if (isBilibiliUrl(url)) {
    return await resolveBilibili(url);
  }
  return null;
}
