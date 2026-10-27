import { attachResolverTab, claimEpisode, failEpisode, startNativeDownload, type NativeTask } from './downloads';
import type { VideoCandidate } from '../shared/types';

const running = new Map<string, Promise<void>>();
let pumping = false;
const activeStages = ['resolving', 'preparing', 'downloading'];

async function resolveEpisode(task: NativeTask): Promise<VideoCandidate> {
  let tab: chrome.tabs.Tab | undefined;
  if (task.resolverTabId !== undefined) tab = await chrome.tabs.get(task.resolverTabId).catch(() => undefined);
  const needsNavigation = Boolean(tab && (!tab.url || tab.url === 'about:blank'));
  if (!tab) tab = await chrome.tabs.create({ url: task.episode!.url, active: false });
  const tabId = tab.id!;
  try {
    await attachResolverTab(task.taskId, task.runId!, tabId);
    return await new Promise<VideoCandidate>((resolve, reject) => {
      let settled = false;
      let pickTimer: ReturnType<typeof setTimeout> | undefined;
      const remaining = Math.max(1, 60000 - (Date.now() - (task.resolutionStartedAt || Date.now())));
      const timeout = setTimeout(() => finish(undefined, new Error('60 秒内未发现此集媒体；可打开播放页完成验证后重试')), remaining);
      const cleanup = () => { clearTimeout(timeout); clearTimeout(pickTimer); chrome.storage.onChanged.removeListener(onStorage); chrome.tabs.onRemoved.removeListener(onRemoved); };
      const finish = (candidate?: VideoCandidate, error?: Error) => {
        if (settled) return; settled = true; cleanup(); candidate ? resolve(candidate) : reject(error);
      };
      const inspect = async () => {
        const data = await chrome.storage.session.get('tabCandidates');
        const candidates = (data.tabCandidates?.[tabId] || []) as VideoCandidate[];
        const preferred = candidates.find(candidate => candidate.playerConfig && ['hls', 'mp4', 'webm'].includes(candidate.kind));
        if (preferred) { finish(preferred); return; }
        const fallback = candidates.filter(candidate => ['hls', 'mp4', 'webm'].includes(candidate.kind)).sort((a, b) => Number(b.kind === 'hls') - Number(a.kind === 'hls') || (b.size || 0) - (a.size || 0))[0];
        if (fallback && !pickTimer) pickTimer = setTimeout(() => finish(fallback), fallback.kind === 'hls' ? 2500 : 5000);
      };
      const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === 'session' && changes.tabCandidates) void inspect().catch(error => finish(undefined, error));
        if (area === 'local' && changes.nativeDownloadTasks) {
          const latest = changes.nativeDownloadTasks.newValue?.[task.taskId];
          if (!latest || latest.stage !== 'resolving' || latest.runId !== task.runId) finish(undefined, new Error('剧集解析已停止'));
        }
      };
      const onRemoved = (removedId: number) => { if (removedId === tabId) finish(undefined, new Error('解析标签页已关闭，请重试')); };
      chrome.storage.onChanged.addListener(onStorage); chrome.tabs.onRemoved.addListener(onRemoved);
      void inspect().catch(error => finish(undefined, error));
      if (needsNavigation) void chrome.tabs.update(tabId, { url: task.episode!.url }).catch(error => finish(undefined, error));
    });
  } finally { await chrome.tabs.remove(tabId).catch(() => {}); }
}

async function runEpisode(task: NativeTask) {
  try {
    const candidate = await resolveEpisode(task);
    await startNativeDownload({ ...candidate, id: task.taskId, title: `${task.episode!.seriesTitle} ${task.episode!.name}` }, task.runId);
  } catch (error) { await failEpisode(task.taskId, task.runId!, error); }
}

export async function pumpEpisodeQueue() {
  if (pumping) return;
  pumping = true;
  try {
    const tasks = Object.values((await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks || {}) as NativeTask[];
    // A restarted worker reattaches to persisted resolving tabs before claiming new work.
    const recover = tasks.filter(task => task.episode && task.stage === 'resolving' && !running.has(task.taskId));
    let slots = Math.max(0, 2 - tasks.filter(task => activeStages.includes(task.stage)).length);
    const queued = tasks.filter(task => task.episode && task.stage === 'queued').sort((a, b) => (a.queueOrder || a.startedAt || 0) - (b.queueOrder || b.startedAt || 0)).slice(0, slots);
    for (const candidate of [...recover, ...queued]) {
      if (running.has(candidate.taskId)) continue;
      const task = await claimEpisode(candidate.taskId);
      if (!task) continue;
      const job = runEpisode(task).finally(() => { running.delete(task.taskId); void pumpEpisodeQueue().catch(console.error); });
      running.set(task.taskId, job);
    }
  } finally { pumping = false; }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.nativeDownloadTasks) return;
  const { oldValue = {}, newValue = {} } = changes.nativeDownloadTasks;
  if (Object.keys(newValue).length !== Object.keys(oldValue).length || Object.values(newValue).some((task: any) => task.stage !== oldValue[task.taskId]?.stage)) void pumpEpisodeQueue().catch(console.error);
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'episode-queue') void pumpEpisodeQueue().catch(console.error); });
void chrome.alarms.create('episode-queue', { periodInMinutes: 0.5 });
void pumpEpisodeQueue().catch(console.error);
