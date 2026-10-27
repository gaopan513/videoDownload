import type { VideoCandidate, EpisodeSelection } from '../shared/types';
import { cleanTitle } from '../core/utils';
import { requestUrl, validateDirectResponse } from '../core/media';
import { buildEpisodeRange } from '../core/episode-range';

export interface NativeTask {
  taskId: string;
  candidate?: Pick<VideoCandidate, 'title' | 'url' | 'kind' | 'size'>;
  startedAt?: number;
  requestCandidate?: VideoCandidate;
  runId?: string;
  phase?: 'fetching' | 'saving';
  filename?: string;
  notice?: string;
  downloadId?: number;
  ruleId: number;
  ruleIds?: number[];
  episode?: EpisodeSelection;
  resolverTabId?: number;
  resolutionStartedAt?: number;
  queueOrder?: number;
  stage: 'queued' | 'resolving' | 'preparing' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';
  percentage: number;
  errorMessage?: string;
  objectUrl?: string;
  diagnostics?: Record<string, unknown>;
}

const key = 'nativeDownloadTasks';
// Serialize mutations, including fast onChanged events during download startup.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(action: () => Promise<T>): Promise<T> {
  const result = queue.then(action);
  queue = result.catch(() => {});
  return result;
}
async function readTasks(): Promise<Record<string, NativeTask>> {
  const stored = (await chrome.storage.local.get(key))[key];
  if (stored) return stored;
  const legacy = (await chrome.storage.session.get(key))[key] || {};
  await chrome.storage.local.set({ [key]: legacy });
  return legacy;
}
async function saveTask(task: NativeTask) {
  const tasks = await readTasks();
  tasks[task.taskId] = task;
  await chrome.storage.local.set({ [key]: tasks });
}
async function removeRule(task: NativeTask) {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [task.ruleId, ...(task.ruleIds || [])] });
  if (task.objectUrl && await chrome.offscreen.hasDocument()) await chrome.runtime.sendMessage({ target: 'offscreen', type: 'RELEASE_BLOB', url: task.objectUrl }).catch(console.error);
  task.objectUrl = undefined;
}

export function prepareHlsRequest(taskId: string, runId: string, rawUrl: string) {
  return serialized(async () => {
    const task = (await readTasks())[taskId];
    if (!task || task.runId !== runId || task.stage !== 'downloading' || task.candidate?.kind !== 'hls') throw new Error('HLS 任务已停止');
    const candidate = task.requestCandidate!;
    const url = requestUrl(rawUrl);
    const headers: chrome.declarativeNetRequest.ModifyHeaderInfo[] = [];
    const referer = candidate.headers?.Referer || candidate.sourceUrl;
    if (referer && referer !== candidate.url && /^https?:\/\//i.test(referer)) headers.push({ header: 'Referer', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: requestUrl(referer) });
    if (candidate.headers?.Origin && /^https?:\/\//i.test(candidate.headers.Origin)) headers.push({ header: 'Origin', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: new URL(candidate.headers.Origin).origin });
    if (!headers.length) return;
    const regexFilter = `^${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    if (rules.some(rule => task.ruleIds?.includes(rule.id) && rule.condition.regexFilter === regexFilter)) return;
    const id = Math.max(task.ruleId, 10000, ...rules.map(rule => rule.id)) + 1;
    await chrome.declarativeNetRequest.updateSessionRules({ addRules: [{ id, priority: 1,
      action: { type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS, requestHeaders: headers },
      condition: { regexFilter, initiatorDomains: [chrome.runtime.id], resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST], isUrlFilterCaseSensitive: true } }] });
    task.ruleIds = [...(task.ruleIds || []), id]; await saveTask(task);
  });
}

async function restoreRequestRule(task: NativeTask) {
  const candidate = task.requestCandidate!;
  const url = requestUrl(candidate.url);
  const regexFilter = `^${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  if (rules.some(rule => rule.id === task.ruleId && rule.condition.regexFilter === regexFilter)) return;
  const headers: chrome.declarativeNetRequest.ModifyHeaderInfo[] = [];
  const referer = candidate.headers?.Referer || candidate.sourceUrl;
  if (referer && referer !== candidate.url && /^https?:\/\//i.test(referer)) headers.push({ header: 'Referer', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: requestUrl(referer) });
  if (candidate.headers?.Origin && /^https?:\/\//i.test(candidate.headers.Origin)) headers.push({ header: 'Origin', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: new URL(candidate.headers.Origin).origin });
  if (!headers.length) return;
  const tasks = await readTasks();
  task.ruleId = Math.max(10000, ...rules.map(rule => rule.id), ...Object.values(tasks).map(task => task.ruleId)) + 1;
  await chrome.declarativeNetRequest.updateSessionRules({ addRules: [{ id: task.ruleId, priority: 1,
    action: { type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS, requestHeaders: headers },
    condition: { regexFilter, excludedTabIds: candidate.tabId === undefined ? undefined : [candidate.tabId], isUrlFilterCaseSensitive: true } }] });
}

async function refreshTask(task: NativeTask): Promise<NativeTask> {
  if (task.downloadId === undefined || ['completed', 'failed', 'cancelled'].includes(task.stage)) return task;
  const [item] = await chrome.downloads.search({ id: task.downloadId });
  if (!item) {
    task.stage = 'failed';
    task.errorMessage = '下载记录已移除';
  } else if (/text\/html|application\/xhtml|application\/json/i.test(item.mime)) {
    if (item.state === 'in_progress') await chrome.downloads.cancel(item.id);
    task.stage = 'failed';
    task.errorMessage = '服务器返回了网页，已停止保存；请重新播放后捕获视频';
  } else if (item.state === 'interrupted') {
    task.stage = 'failed';
    task.errorMessage = `Chrome 下载中断：${item.error || '未知错误'}`;
  } else if (item.state === 'complete') {
    task.stage = 'completed';
    task.percentage = 100;
  } else {
    task.stage = item.paused ? 'paused' : 'downloading';
    task.percentage = item.totalBytes > 0 ? Math.min(99, Math.floor(item.bytesReceived / item.totalBytes * 100)) : 0;
  }
  if (item?.filename) task.filename = item.filename;
  if (['completed', 'failed'].includes(task.stage)) await removeRule(task);
  await saveTask(task);
  return task;
}

export function handleBufferedResult(taskId: string, runId: string | undefined, result: any) {
  return serialized(async () => {
    const current = (await readTasks())[taskId];
    if (!current || current.runId !== runId || ['paused', 'cancelled'].includes(current.stage)) {
      if (result?.url) await chrome.runtime.sendMessage({ target: 'offscreen', type: 'RELEASE_BLOB', url: result.url });
      return;
    }
    if (result?.paused || result?.cancelled || result?.accepted) return;
    if (result?.error || !result?.url) {
      current.stage = 'failed'; current.errorMessage = result?.error || '后台视频获取失败';
      await removeRule(current); await saveTask(current); return;
    }
    if (current.downloadId !== undefined || current.objectUrl === result.url) return;
    const candidate = current.requestCandidate!;
    current.objectUrl = result.url; current.diagnostics = result.diagnostics; current.phase = 'saving'; current.percentage = 99;
    await saveTask(current);
    const filename = current.episode
      ? `StreamHarbor/${cleanTitle(current.episode.seriesTitle)}/${cleanTitle(current.episode.lineName)}_${cleanTitle(current.episode.name)}.${candidate.kind === 'hls' ? 'ts' : candidate.kind}`
      : `${cleanTitle(candidate.title)}.${candidate.kind === 'hls' ? 'ts' : candidate.kind}`;
    void chrome.downloads.download({ url: result.url, filename, saveAs: false }).then(downloadId => serialized(async () => {
      const latest = (await readTasks())[taskId];
      if (!latest || latest.runId !== runId || latest.stage === 'cancelled') {
        await chrome.downloads.cancel(downloadId).catch(() => {}); return;
      }
      latest.downloadId = downloadId; await saveTask(latest); await refreshTask(latest);
    })).catch(error => handleBufferedResult(taskId, runId, { error: error.message || String(error) })).catch(console.error);
  });
}

function dispatchBuffered(task: NativeTask, candidate: VideoCandidate, resume = false) {
  const runId = task.runId;
  const fail = (error: unknown) => serialized(async () => {
    const current = (await readTasks())[task.taskId];
    if (!current || current.runId !== runId || ['paused', 'cancelled'].includes(current.stage)) return;
    current.stage = 'failed'; current.errorMessage = error instanceof Error ? error.message : String(error);
    await removeRule(current); await saveTask(current);
  });
  void chrome.runtime.sendMessage({ target: 'offscreen', type: 'FETCH_VIDEO', candidate, runId, resume })
    .then(result => handleBufferedResult(task.taskId, runId, result)).catch(fail).catch(console.error);
}

export function getNativeTasks() {
  return serialized(async () => {
    const tasks = await readTasks();
    // Upgrade tasks started by the previous extension build when their capture
    // metadata is still available. New tasks keep it even after tab removal.
    const stored = await chrome.storage.session.get('tabCandidates');
    const captured = Object.values(stored.tabCandidates || {}).flat() as VideoCandidate[];
    const hasDocument = await chrome.offscreen.hasDocument();
    for (const task of Object.values(tasks)) {
      if (!task.candidate) {
        const candidate = captured.find(candidate => candidate.id === task.taskId);
        if (candidate) {
          task.candidate = { title: candidate.title, url: candidate.url, kind: candidate.kind, size: candidate.size };
          task.requestCandidate = candidate;
          await saveTask(task);
        }
      }
      await refreshTask(task);
      if (!hasDocument && task.downloadId === undefined && ['preparing', 'downloading'].includes(task.stage)) {
        task.stage = 'paused'; task.objectUrl = undefined; task.phase = 'fetching';
        task.notice = '后台暂存已结束，点击继续将重新获取视频';
        await saveTask(task);
      }
    }
    return tasks;
  });
}

export function startNativeDownload(candidate: VideoCandidate, expectedRunId?: string) {
  return serialized(async () => {
    const tasks = await readTasks();
    const url = requestUrl(candidate.url);
    const previous = tasks[candidate.id] || Object.values(tasks).find(task => ['preparing', 'downloading', 'paused'].includes(task.stage) && task.candidate?.url === url);
    if (expectedRunId && (!previous || previous.runId !== expectedRunId || previous.stage !== 'resolving')) throw new Error('剧集解析任务已停止');
    if (previous && ['preparing', 'downloading', 'paused'].includes(previous.stage)) return refreshTask(previous);
    if (!['mp4', 'webm', 'hls'].includes(candidate.kind)) throw new Error('此入口仅支持 MP4/WebM/HLS');
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const ruleId = Math.max(10000, ...rules.map(rule => rule.id), ...Object.values(tasks).map(task => task.ruleId)) + 1;
    const task: NativeTask = { taskId: candidate.id, ruleId, stage: 'preparing', percentage: 0, startedAt: Date.now(),
      episode: previous?.episode,
      requestCandidate: { ...candidate, url }, runId: crypto.randomUUID(), phase: 'fetching',
      candidate: { title: candidate.title, url, kind: candidate.kind, size: candidate.size } };
    await saveTask(task);
    try {
      if (candidate.kind === 'hls') {
        if (!await chrome.offscreen.hasDocument()) await chrome.offscreen.createDocument({
          url: 'src/offscreen/index.html', reasons: [chrome.offscreen.Reason.BLOBS], justification: '后台获取 HLS 分片并解密合并，弹窗关闭后继续下载'
        });
        task.stage = 'downloading'; await saveTask(task);
        dispatchBuffered(task, task.requestCandidate!); return task;
      }
      const headers: chrome.declarativeNetRequest.ModifyHeaderInfo[] = [];
      const referer = candidate.headers?.Referer || candidate.sourceUrl;
      if (referer && referer !== candidate.url && /^https?:\/\//i.test(referer)) {
        headers.push({ header: 'Referer', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: requestUrl(referer) });
      }
      if (candidate.headers?.Origin && /^https?:\/\//i.test(candidate.headers.Origin)) {
        headers.push({ header: 'Origin', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: new URL(candidate.headers.Origin).origin });
      }
      // Referer is forbidden in downloads.download and DNR does not cover its
      // native request. Apply the rule to extension fetches, then export a Blob.
      if (headers.length) await chrome.declarativeNetRequest.updateSessionRules({ addRules: [{
        id: ruleId, priority: 1,
        action: { type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS, requestHeaders: headers },
        condition: { regexFilter: `^${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, excludedTabIds: candidate.tabId === undefined ? undefined : [candidate.tabId], isUrlFilterCaseSensitive: true }
      }] });
      const response = await fetch(url, { credentials: 'include', cache: 'no-store', headers: { Range: 'bytes=0-4095' }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`视频预检失败 HTTP ${response.status}，请重新播放后捕获链接`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('视频响应为空');
      const prefix = new Uint8Array(512);
      let length = 0;
      try {
        while (length < prefix.length) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = value.subarray(0, prefix.length - length);
          prefix.set(chunk, length);
          length += chunk.length;
        }
      } finally { await reader.cancel(); }
      validateDirectResponse(response.headers.get('content-type') || '', prefix.subarray(0, length), candidate.kind);
      if (!await chrome.offscreen.hasDocument()) await chrome.offscreen.createDocument({
        url: 'src/offscreen/index.html', reasons: [chrome.offscreen.Reason.BLOBS], justification: '后台获取带播放来源的视频并创建本地保存 Blob，弹窗关闭后继续下载'
      });
      task.stage = 'downloading';
      await saveTask(task);
      dispatchBuffered(task, task.requestCandidate!);
      return task;
    } catch (error) {
      task.stage = 'failed';
      task.errorMessage = error instanceof Error ? error.message : String(error);
      await removeRule(task);
      await saveTask(task);
      return task;
    }
  });
}

export function updateBufferedProgress(taskId: string, percentage: number, runId?: string, notice?: string) {
  return serialized(async () => {
    const task = (await readTasks())[taskId];
    if (task && task.stage === 'downloading' && (!runId || task.runId === runId)) {
      task.percentage = Math.min(99, Math.max(0, percentage));
      if (notice) task.notice = notice;
      await saveTask(task);
    }
  });
}

export function clearCompletedTasks() {
  return serialized(async () => {
    const tasks = await readTasks();
    const completed = Object.values(tasks).filter(task => task.stage === 'completed');
    for (const task of completed) delete tasks[task.taskId];
    await chrome.storage.local.set({ [key]: tasks });
    return { removed: completed.length };
  });
}

export async function controlNativeTask(taskId: string, action: string) {
  if (action === 'retry') {
    const task = (await getNativeTasks())[taskId];
    if (!task || !['failed', 'cancelled'].includes(task.stage)) throw new Error('此任务当前不能重试');
    if (task.episode) return requeueEpisode(taskId);
    if (!task.requestCandidate) throw new Error('旧任务缺少来源信息，请重新捕获视频');
    return startNativeDownload(task.requestCandidate);
  }
  return serialized(async () => {
    const tasks = await readTasks(); const task = tasks[taskId];
    if (!task) throw new Error('下载任务不存在');
    await refreshTask(task);
    if (action === 'remove') {
      if (!['completed', 'failed', 'cancelled'].includes(task.stage)) throw new Error('请先取消正在下载的任务');
      delete tasks[taskId]; await chrome.storage.local.set({ [key]: tasks }); return;
    }
    if (action === 'open' || action === 'show') {
      if (task.stage !== 'completed' || task.downloadId === undefined) throw new Error('文件尚未保存完成');
      if (action === 'show') chrome.downloads.show(task.downloadId);
      else await chrome.downloads.open(task.downloadId);
      return task;
    }
    if (action === 'pause') {
      if (task.stage !== 'downloading') throw new Error('此任务当前不能暂停');
      if (task.downloadId !== undefined) await chrome.downloads.pause(task.downloadId);
      else {
        if (task.phase === 'saving') throw new Error('请先处理保存窗口');
        await chrome.runtime.sendMessage({ target: 'offscreen', type: 'CONTROL_BUFFER', taskId, action: 'pause' });
      }
      task.stage = 'paused'; await saveTask(task); return task;
    }
    if (action === 'resume') {
      if (task.stage !== 'paused') throw new Error('此任务当前不能继续');
      if (task.downloadId !== undefined) await chrome.downloads.resume(task.downloadId);
      else {
        if (!task.requestCandidate) throw new Error('旧任务缺少来源信息，请重新捕获视频');
        if (!await chrome.offscreen.hasDocument()) await chrome.offscreen.createDocument({ url: 'src/offscreen/index.html', reasons: [chrome.offscreen.Reason.BLOBS], justification: '恢复后台下载任务' });
        await restoreRequestRule(task);
        task.runId = crypto.randomUUID(); task.stage = 'downloading'; await saveTask(task);
        dispatchBuffered(task, task.requestCandidate, true);
      }
      task.stage = 'downloading'; await saveTask(task); return task;
    }
    if (action === 'cancel') {
      if (!['queued', 'resolving', 'preparing', 'downloading', 'paused'].includes(task.stage)) throw new Error('此任务当前不能取消');
      if (task.downloadId !== undefined) await chrome.downloads.cancel(task.downloadId);
      else if (await chrome.offscreen.hasDocument()) await chrome.runtime.sendMessage({ target: 'offscreen', type: 'CONTROL_BUFFER', taskId, action: 'cancel' });
      task.stage = 'cancelled'; await removeRule(task); await saveTask(task); return task;
    }
    throw new Error('未知任务操作');
  });
}

export function enqueueEpisodeRange(firstUrl: string, lastUrl: string, title: string, selectedIds: string[]) {
  const range = buildEpisodeRange(firstUrl, lastUrl);
  if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.some(id => !range.episodes.some(episode => episode.id === id))) throw new Error('请选择生成范围中的剧集');
  const episodes = range.episodes.filter(episode => selectedIds.includes(episode.id)).map(episode => ({ ...episode, seriesTitle: title || '批量剧集', seriesUrl: range.firstUrl, lineId: 'range', lineName: '剧集' }));
  return enqueueEpisodes(episodes);
}

function enqueueEpisodes(episodes: EpisodeSelection[]) {
  return serialized(async () => {
    if (!Array.isArray(episodes) || !episodes.length || episodes.length > 2000) throw new Error('请选择 1 至 2000 集');
    const tasks = await readTasks(); const added: NativeTask[] = []; let reused = 0;
    let queueOrder = Math.max(0, ...Object.values(tasks).map(task => task.queueOrder || 0));
    for (const selection of episodes) {
      const url = requestUrl(selection.url); const page = new URL(url); const series = new URL(requestUrl(selection.seriesUrl));
      if (page.origin !== series.origin) throw new Error('剧集播放地址与批量范围不一致');
      if (Object.values(tasks).some(task => task.episode?.url === url || (task.requestCandidate?.sourceUrl === url && !['failed', 'cancelled'].includes(task.stage)))) { reused++; continue; }
      const taskId = `episode_${crypto.randomUUID()}`;
      const episode = { ...selection, id: selection.id, url, name: cleanTitle(selection.name), seriesTitle: cleanTitle(selection.seriesTitle), lineName: cleanTitle(selection.lineName) };
      const task: NativeTask = { taskId, episode, queueOrder: ++queueOrder, candidate: { title: `${episode.seriesTitle} ${episode.name}`, url, kind: 'unknown' }, ruleId: 0, stage: 'queued', percentage: 0, startedAt: Date.now() };
      tasks[taskId] = task; added.push(task);
    }
    await chrome.storage.local.set({ [key]: tasks }); return { added: added.length, reused };
  });
}
function requeueEpisode(taskId: string) {
  return serialized(async () => {
    const task = (await readTasks())[taskId];
    if (!task?.episode || !['failed', 'cancelled'].includes(task.stage)) throw new Error('此剧集当前不能重试');
    await removeRule(task);
    task.stage = 'queued'; task.percentage = 0; task.errorMessage = undefined; task.notice = undefined;
    task.runId = undefined; task.resolverTabId = undefined; task.requestCandidate = undefined; task.downloadId = undefined; task.ruleIds = undefined;
    task.candidate = { title: `${task.episode.seriesTitle} ${task.episode.name}`, url: task.episode.url, kind: 'unknown' };
    await saveTask(task); return task;
  });
}
export function claimEpisode(taskId: string) {
  return serialized(async () => {
    const task = (await readTasks())[taskId];
    if (!task?.episode || !['queued', 'resolving'].includes(task.stage)) return;
    if (task.stage === 'queued') { task.stage = 'resolving'; task.runId = crypto.randomUUID(); task.resolutionStartedAt = Date.now(); }
    await saveTask(task); return task;
  });
}
export function attachResolverTab(taskId: string, runId: string, tabId: number) {
  return serialized(async () => {
    const task = (await readTasks())[taskId];
    if (!task || task.stage !== 'resolving' || task.runId !== runId) throw new Error('剧集任务已停止');
    task.resolverTabId = tabId; await saveTask(task);
  });
}
export function failEpisode(taskId: string, runId: string, error: unknown) {
  return serialized(async () => {
    const task = (await readTasks())[taskId];
    if (!task || task.stage !== 'resolving' || task.runId !== runId) return;
    task.stage = 'failed'; task.resolverTabId = undefined;
    task.errorMessage = error instanceof Error ? error.message : String(error); await saveTask(task);
  });
}

chrome.downloads.onChanged.addListener(delta => {
  void serialized(async () => {
    const tasks = await readTasks();
    const task = Object.values(tasks).find(task => task.downloadId === delta.id);
    if (task) await refreshTask(task);
  }).catch(console.error);
});
