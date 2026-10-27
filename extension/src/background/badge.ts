let badgeQueue: Promise<unknown> = Promise.resolve();
const counts = new Map<number, number>();
export function syncCaptureBadges() {
  badgeQueue = badgeQueue.catch(() => {}).then(async () => {
    const [stored, tabs] = await Promise.all([chrome.storage.session.get('tabCandidates'), chrome.tabs.query({})]);
    const liveIds = new Set(tabs.map(tab => tab.id));
    for (const id of counts.keys()) if (!liveIds.has(id)) counts.delete(id);
    await Promise.all(tabs.filter(tab => tab.id !== undefined).map(async tab => {
      const id = tab.id!;
      const count = stored.tabCandidates?.[id]?.length || 0;
      if (counts.get(id) === count) return;
      await chrome.action.setBadgeText({ tabId: id, text: count ? String(count) : '' }).catch(() => {});
      await chrome.action.setTitle({ tabId: id, title: count ? `StreamHarbor · 本页捕获 ${count} 个资源` : 'StreamHarbor · 本页暂无捕获资源' }).catch(() => {});
      counts.set(id, count);
    }));
  });
  return badgeQueue;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.tabCandidates) void syncCaptureBadges().catch(console.error);
});
// Replace the older global download counter with each tab's captured resource count.
void Promise.all([
  chrome.action.setBadgeText({ text: '' }),
  chrome.action.setBadgeBackgroundColor({ color: '#00a86b' }),
  chrome.action.setTitle({ title: 'StreamHarbor 视频嗅探与下载' })
]).then(syncCaptureBadges).catch(console.error);
