import { isMetaVideoUrl, metaPlatform, metaPostId } from '../core/meta-media';
import type { VideoCandidate } from '../shared/types';

export async function resolveMetaTab(raw: string): Promise<VideoCandidate[]> {
  if (!isMetaVideoUrl(raw)) throw new Error('请填写 Instagram 视频帖/Reel，或 Facebook 视频/Watch/Reel 分享链接');
  const platform = metaPlatform(raw)!;
  const target = metaPostId(raw);
  const tabs = await chrome.tabs.query({});
  let tab = target ? tabs.find(tab => tab.url && metaPlatform(tab.url) === platform && metaPostId(tab.url) === target) : undefined;
  const owned = !tab;
  if (!tab) tab = await chrome.tabs.create({ url: raw, active: false });
  const id = tab.id!;
  let success = false;
  try {
    const until = Date.now() + 25000;
    while (Date.now() < until) {
      const current = await chrome.tabs.get(id).catch(() => undefined);
      if (!current) throw new Error('解析页面已关闭，请重新打开视频页');
      const data = await chrome.storage.session.get(['tabCandidates', 'tabMediaNotices']);
      const candidates = (data.tabCandidates?.[id] || []) as VideoCandidate[];
      const selected = candidates.filter(candidate => candidate.platform === platform && metaPlatform(candidate.sourceUrl) === platform && (!target || metaPostId(candidate.sourceUrl) === target));
      if (selected.length) {
        // Let initial scripts/Relay responses finish before returning all qualities/carousel items.
        await new Promise(resolve => setTimeout(resolve, 800));
        const latest = (await chrome.storage.session.get('tabCandidates')).tabCandidates?.[id] || [];
        const resolved = (latest as VideoCandidate[]).filter(candidate => candidate.platform === platform && (!target || metaPostId(candidate.sourceUrl) === target));
        if (resolved.length) { success = true; return resolved; }
      }
      if (current.status === 'complete' && /\/(?:accounts\/login|login|checkpoint)(?:\/|\.php|\?)/.test(current.url || '')) throw new Error(`${platform} 要求登录或验证；已保留视频标签页，完成后打开视频并重新解析`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const data = await chrome.storage.session.get('tabMediaNotices');
    if (data.tabMediaNotices?.[id]) throw new Error(`${platform} 此视频仅检测到 DASH 音视频分离流，当前扩展无法合并；已保留页面，可播放后重新捕获`);
    throw new Error(`${platform} 未返回可下载的完整视频；已保留标签页，请打开并播放，完成登录/验证后重新解析。私密或纯图片内容无法解析`);
  } finally {
    if (owned && success) await chrome.tabs.remove(id).catch(() => {});
  }
}
