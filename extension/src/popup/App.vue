<template>
  <div class="popup-container">
    <!-- 顶部导航 -->
    <header class="header">
      <div class="brand">
        <span class="logo-dot"></span>
        <h1 class="title">StreamHarbor</h1>
        <span class="badge-tag">嗅探</span>
        <span class="version-tag">v{{ extensionVersion }}</span>
      </div>
    </header>

    <nav class="page-tabs" role="tablist" aria-label="工作台页面" @keydown="navigateTabs">
      <button v-for="page in pages" :id="`tab-${page.id}`" :key="page.id" role="tab" :data-view="page.id" :aria-controls="`panel-${page.id}`" :aria-selected="activePage === page.id" :tabindex="activePage === page.id ? 0 : -1" :class="{ active: activePage === page.id }" @click="activePage = page.id">
        {{ page.label }}<span v-if="page.id === 'captures'" class="tab-count">{{ candidates.length }}</span><span v-if="page.id === 'downloads'" class="tab-count">{{ downloadTasks.length }}</span>
      </button>
    </nav>

    <!-- 手动输入解析区 -->
    <section v-show="activePage === 'captures'" class="manual-input-box">
      <input
        v-model="manualUrl"
        type="text"
        placeholder="B站 / Instagram / Facebook / 视频直链"
        @keyup.enter="handleManualResolve"
      />
      <button :disabled="resolvingManual" @click="handleManualResolve">
        {{ resolvingManual ? '解析中' : '解析' }}
      </button>
    </section>

    <p v-if="activePage === 'captures' && mediaNotice" class="meta-notice" role="status">{{ mediaNotice }}</p>

    <!-- 提示消息 -->
    <div v-if="tipMessage" role="status" class="tip-banner" :class="tipType">
      {{ tipMessage }}
    </div>

    <!-- 标签页与嗅探结果列表 -->
    <main class="content-body">
      <section v-show="activePage === 'downloads'" id="panel-downloads" role="tabpanel" aria-labelledby="tab-downloads" class="download-tasks" aria-label="下载任务">
        <div class="section-title-bar">
          <span>下载任务 ({{ downloadTasks.length }})</span>
          <button class="text-link clear-completed" title="仅清除记录，保留下载文件" :disabled="!completedCount || clearingCompleted" @click="clearCompleted">{{ clearingCompleted ? '清空中…' : '清空已完成记录' }}</button>
        </div>
        <p v-if="downloadSyncError" class="task-error">{{ downloadSyncError }}</p>
        <p v-else-if="!downloadTasks.length" class="no-tasks">暂无后台下载任务</p>
        <div class="candidate-list">
          <div v-for="task in downloadTasks" :key="task.taskId" class="candidate-card" :data-task-id="task.taskId">
            <div class="card-top">
              <span v-if="task.candidate" class="kind-tag" :class="task.candidate.kind">{{ task.episode && !task.requestCandidate ? '剧集' : task.candidate.kind.toUpperCase() }}</span>
              <span class="video-title" :title="task.candidate?.title">{{ task.candidate?.title || '视频下载任务' }}</span>
            </div>
            <div v-if="task.candidate" class="card-meta">
              <span v-if="task.candidate.size">{{ formatFileSize(task.candidate.size) }}</span>
              <span class="url-text" :title="task.candidate.url">{{ task.candidate.url }}</span>
            </div>
            <div class="progress-container">
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" :style="{ width: task.percentage + '%' }"></div>
              </div>
              <div class="progress-info">
                <span>{{ progressMap[task.taskId]?.stageText || '准备中' }} ({{ task.percentage }}%)</span>
                <span>{{ task.stage === 'completed' ? '已保存到本地' : task.stage === 'downloading' ? task.phase === 'saving' ? '保存到本地' : '后台下载' : '' }}</span>
              </div>
              <div v-if="task.errorMessage" class="task-error">{{ task.errorMessage }}</div>
              <div v-if="task.notice" class="task-notice">{{ task.notice }}</div>
            </div>
            <div class="card-actions task-actions">
              <button v-if="task.stage === 'downloading' && (task.phase !== 'saving' || task.downloadId !== undefined)" class="btn btn-secondary" :disabled="taskActionBusy[task.taskId]" @click="controlTask(task, 'pause')">暂停</button>
              <button v-if="task.stage === 'paused'" class="btn btn-primary" :disabled="taskActionBusy[task.taskId]" @click="controlTask(task, 'resume')">继续</button>
              <button v-if="task.stage === 'failed' || task.stage === 'cancelled'" class="btn btn-primary" :disabled="taskActionBusy[task.taskId] || (!task.requestCandidate && !task.episode)" @click="controlTask(task, 'retry')">重试</button>
              <button v-if="['queued', 'resolving', 'preparing', 'downloading', 'paused'].includes(task.stage)" class="btn btn-danger" :disabled="taskActionBusy[task.taskId]" @click="controlTask(task, 'cancel')">取消下载</button>
              <button v-if="task.stage === 'completed'" class="btn btn-secondary" :disabled="taskActionBusy[task.taskId]" @click="controlTask(task, 'open')">打开文件</button>
              <button v-if="task.stage === 'completed'" class="btn btn-secondary" :disabled="taskActionBusy[task.taskId]" @click="controlTask(task, 'show')">显示文件夹</button>
              <button v-if="task.stage === 'completed' || task.stage === 'failed' || task.stage === 'cancelled'" class="btn btn-secondary" :disabled="taskActionBusy[task.taskId]" @click="controlTask(task, 'remove')">移除记录</button>
            </div>
          </div>
        </div>
      </section>
      <section v-show="activePage === 'series'" id="panel-series" role="tabpanel" aria-labelledby="tab-series" class="series-section" aria-label="剧集批量下载">
        <div class="section-title-bar"><span>剧集批量下载</span><button class="text-link clear-range" :disabled="!draftReady || batchStarting" @click="clearBatchInputs">清空输入框</button></div>
        <label class="range-field">第一集播放页链接<input v-model="firstEpisodeUrl" type="url" placeholder="https://www.libvio.io/w/714893650-3-1.html" /></label>
        <label class="range-field">最后一集播放页链接<input v-model="lastEpisodeUrl" type="url" placeholder="同一作品、同一线路的最后一集链接" /></label>
        <label class="range-field">作品名称（选填）<input v-model="batchTitle" type="text" placeholder="用于任务名称和保存文件夹" /></label>
        <button class="btn btn-secondary range-preview" :disabled="!firstEpisodeUrl.trim() || !lastEpisodeUrl.trim() || batchStarting" @click="generateRange">生成剧集列表</button>
        <p v-if="rangeError" class="task-error" role="alert">{{ rangeError }}</p>
        <template v-if="episodeRange">
          <p class="series-title">共 {{ seriesEpisodes.length }} 集，网址编号 {{ episodeRange.firstNumber }} → {{ episodeRange.lastNumber }}</p>
          <div class="series-tools"><button class="text-link" @click="selectedEpisodes = seriesEpisodes.map(episode => episode.id)">全选</button><button class="text-link" @click="selectedEpisodes = []">全不选</button><span>已选 {{ selectedEpisodes.length }} / {{ seriesEpisodes.length }}</span></div>
          <div class="episode-grid"><label v-for="episode in seriesEpisodes" :key="episode.id" :title="episode.url"><input v-model="selectedEpisodes" type="checkbox" :value="episode.id" /><span>{{ episode.name }}</span></label></div>
          <details class="range-links"><summary>核对生成的播放页链接</summary><div v-for="episode in seriesEpisodes" :key="episode.id">{{ episode.name }}：{{ episode.url }}</div></details>
          <button class="btn btn-primary batch-start" :disabled="!selectedEpisodes.length || batchStarting" @click="startBatch">{{ batchStarting ? '加入队列中…' : `下载所选 ${selectedEpisodes.length} 集` }}</button>
        </template>
        <p class="series-hint">适用于集数编号连续的播放页链接。逐集解析视频，同时下载 2 集；保存到下载目录的 StreamHarbor 文件夹，关闭弹窗后继续。</p>
      </section>
      <section v-show="activePage === 'captures'" id="panel-captures" role="tabpanel" aria-labelledby="tab-captures" class="capture-section" aria-label="当前页面捕获">
      <div class="section-title-bar">
        <span>当前页面捕获 ({{ candidates.length }})</span>
        <button v-if="candidates.length" class="text-link" @click="refreshList">刷新</button>
      </div>

      <div v-if="loading" class="empty-state">
        <div class="spinner"></div>
        <p>正在拉取嗅探结果...</p>
      </div>

      <div v-else-if="!candidates.length" class="empty-state">
        <div class="empty-icon">🎬</div>
        <p>暂未嗅探到媒体流</p>
        <span class="empty-hint">请在当前网页开始播放视频，或粘贴视频链接</span>
      </div>

      <div v-else class="candidate-list">
        <div
          v-for="item in candidates"
          :key="item.id"
          class="candidate-card"
        >
          <div class="card-top">
            <span class="kind-tag" :class="item.kind">{{ item.kind.toUpperCase() }}</span>
            <span class="video-title" :title="item.title">{{ item.title }}</span>
          </div>

          <!-- 清晰度多线路选择 (HLS Master 多码率) -->
          <div v-if="item.details?.playlists?.length" class="quality-selector">
            <label>清晰度：</label>
            <select v-model="selectedQualities[item.id]">
              <option
                v-for="p in item.details.playlists"
                :key="p.quality"
                :value="p.quality"
              >
                {{ p.quality }}
              </option>
            </select>
          </div>

          <div class="card-meta">
            <span v-if="item.quality">{{ item.quality }}</span>
            <span v-if="item.size">{{ formatFileSize(item.size) }}</span>
            <span class="url-text" :title="item.url">{{ item.url }}</span>
          </div>

          <!-- 下载进度条 -->
          <div v-if="progressMap[item.id]" class="progress-container">
            <div class="progress-bar-bg">
              <div
                class="progress-bar-fill"
                :style="{ width: progressMap[item.id].percentage + '%' }"
              ></div>
            </div>
            <div class="progress-info">
              <span>{{ progressMap[item.id].stageText }} ({{ progressMap[item.id].percentage }}%)</span>
              <span>{{ progressMap[item.id].speed }}</span>
            </div>
          </div>

          <!-- 操作按钮栏 -->
          <div class="card-actions">
            <button class="btn btn-secondary" @click="copyUrl(item.url)">
              复制链接
            </button>
            <button
              class="btn btn-primary"
              :disabled="progressMap[item.id]?.downloading || taskForCandidate(item)?.stage === 'paused' || item.kind === 'unknown'"
              @click="startDownload(item)"
            >
              {{ item.kind === 'unknown' ? '等待媒体确认' : taskForCandidate(item)?.stage === 'paused' ? '已暂停' : progressMap[item.id]?.downloading ? '下载中...' : '下载到本地' }}
            </button>
          </div>
        </div>
      </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import type { NativeTask } from '../background/downloads';
import { buildEpisodeRange } from '../core/episode-range';
import { mediaKind } from '../core/media';
import type { VideoCandidate } from '../shared/types';
import { formatBytes, extractMediaUrl } from '../core/utils';
import { resolvePlatform } from '../core/platforms';
import { downloadDirectMp4, downloadHlsStream, type DownloadProgress } from '../core/downloader';

const candidates = ref<VideoCandidate[]>([]);
const mediaNotice = ref('');
const nativeTasks = ref<Record<string, NativeTask>>({});
const extensionVersion = chrome.runtime.getManifest().version;
const pages = [{ id: 'captures', label: '当前页面捕获' }, { id: 'series', label: '剧集批量下载' }, { id: 'downloads', label: '下载任务' }] as const;
const activePage = ref<'captures' | 'series' | 'downloads'>('captures');
function navigateTabs(event: KeyboardEvent) {
  const index = pages.findIndex(page => page.id === activePage.value);
  const next = event.key === 'ArrowRight' ? (index + 1) % pages.length : event.key === 'ArrowLeft' ? (index + pages.length - 1) % pages.length : event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : -1;
  if (next < 0) return;
  event.preventDefault(); activePage.value = pages[next].id;
  document.getElementById(`tab-${activePage.value}`)?.focus();
}
const clearingCompleted = ref(false);
const completedCount = computed(() => downloadTasks.value.filter(task => task.stage === 'completed').length);
const downloadSyncError = ref('');
const firstEpisodeUrl = ref('');
const lastEpisodeUrl = ref('');
const batchTitle = ref('');
const episodeRange = ref<ReturnType<typeof buildEpisodeRange>>();
const selectedEpisodes = ref<string[]>([]);
const rangeError = ref('');
const batchStarting = ref(false);
const seriesEpisodes = computed(() => episodeRange.value?.episodes || []);
const draftReady = ref(false);
let draftTimer: ReturnType<typeof setTimeout>;
watch([firstEpisodeUrl, lastEpisodeUrl], () => { episodeRange.value = undefined; selectedEpisodes.value = []; rangeError.value = ''; }, { flush: 'sync' });
watch([firstEpisodeUrl, lastEpisodeUrl, batchTitle], () => {
  if (!draftReady.value) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { void saveRangeDraft().catch(console.error); }, 150);
});
function saveRangeDraft() { return chrome.storage.local.set({ episodeRangeDraft: { firstUrl: firstEpisodeUrl.value, lastUrl: lastEpisodeUrl.value, title: batchTitle.value } }); }
async function restoreRangeDraft() {
  try {
    const { episodeRangeDraft: draft } = await chrome.storage.local.get('episodeRangeDraft');
    if (draft) { firstEpisodeUrl.value = draft.firstUrl || ''; lastEpisodeUrl.value = draft.lastUrl || ''; batchTitle.value = draft.title || ''; }
  } catch (error) { rangeError.value = '读取批量链接失败，请重新输入'; }
  finally { draftReady.value = true; }
}
function generateRange() {
  try { episodeRange.value = buildEpisodeRange(firstEpisodeUrl.value, lastEpisodeUrl.value); selectedEpisodes.value = episodeRange.value.episodes.map(episode => episode.id); rangeError.value = ''; }
  catch (error) { episodeRange.value = undefined; selectedEpisodes.value = []; rangeError.value = error instanceof Error ? error.message : String(error); }
}
const taskActionBusy = ref<Record<string, boolean>>({});
const downloadTasks = computed(() => Object.values(nativeTasks.value).sort((a, b) => {
  const rank = (task: NativeTask) => ['resolving', 'preparing', 'downloading'].includes(task.stage) ? 0 : ['queued', 'paused'].includes(task.stage) ? 1 : ['failed', 'cancelled'].includes(task.stage) ? 2 : 3;
  return rank(a) - rank(b) || (rank(a) === 1 ? (a.queueOrder || a.startedAt || 0) - (b.queueOrder || b.startedAt || 0) : (b.startedAt || 0) - (a.startedAt || 0));
}));
const loading = ref(true);
const manualUrl = ref('');
const resolvingManual = ref(false);
const tipMessage = ref('');
const tipType = ref<'info' | 'error' | 'success'>('info');

const selectedQualities = ref<Record<string, string>>({});
const progressMap = ref<
  Record<
    string,
    {
      percentage: number;
      speed: string;
      stageText: string;
      downloading: boolean;
    }
  >
>({});

function showTip(msg: string, type: 'info' | 'error' | 'success' = 'info', duration = 3000) {
  tipMessage.value = msg;
  tipType.value = type;
  setTimeout(() => {
    if (tipMessage.value === msg) tipMessage.value = '';
  }, duration);
}

function formatFileSize(bytes: number) {
  return formatBytes(bytes);
}

async function getCurrentTabId(): Promise<number | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

async function loadTabCandidates() {
  loading.value = true;
  const tabId = await getCurrentTabId();
  if (!tabId) {
    loading.value = false;
    return;
  }

  chrome.runtime.sendMessage(
    { type: 'GET_TAB_CANDIDATES', tabId },
    (res) => {
      loading.value = false;
      if (res && res.candidates) {
        candidates.value = res.candidates;
        mediaNotice.value = res.notice || '';
        // 默认选择第一个清晰度
        for (const c of candidates.value) {
          if (c.details?.playlists?.length && !selectedQualities.value[c.id]) {
            selectedQualities.value[c.id] = c.details.playlists[0].quality;
          }
        }
      }
    }
  );
}

async function startBatch() {
  const range = episodeRange.value;
  if (!range || !selectedEpisodes.value.length) return;
  batchStarting.value = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'ENQUEUE_EPISODE_RANGE', firstUrl: range.firstUrl, lastUrl: range.lastUrl, title: batchTitle.value.trim(), selectedIds: [...selectedEpisodes.value] });
    if (response?.error) throw new Error(response.error);
    showTip(`已加入 ${response.added} 集${response.reused ? `，跳过 ${response.reused} 个已有任务` : ''}`, 'success', 5000);
    await refreshDownloads();
  } catch (error) { showTip(error instanceof Error ? error.message : '批量下载启动失败', 'error', 5000); }
  finally { batchStarting.value = false; }
}

async function clearBatchInputs() {
  firstEpisodeUrl.value = ''; lastEpisodeUrl.value = ''; batchTitle.value = '';
  episodeRange.value = undefined; selectedEpisodes.value = []; rangeError.value = '';
  clearTimeout(draftTimer);
  try { await saveRangeDraft(); showTip('已清空输入框', 'success'); }
  catch (error) { showTip('输入已清空，但草稿保存失败，请重试清空', 'error'); }
}
async function clearCompleted() {
  clearingCompleted.value = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CLEAR_COMPLETED_DOWNLOADS' });
    if (response?.error || response?.removed === undefined) throw new Error(response?.error || '后台未响应');
    await refreshDownloads();
    showTip(`已清空 ${response.removed} 条已完成记录`, 'success');
  } catch (error) { showTip(error instanceof Error ? error.message : '清空记录失败', 'error'); }
  finally { clearingCompleted.value = false; }
}

function refreshList() {
  loadTabCandidates();
}

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    showTip('视频链接已复制到剪贴板', 'success');
  } catch {
    showTip('复制失败，请手动选取', 'error');
  }
}

async function handleManualResolve() {
  const raw = manualUrl.value.trim();
  if (!raw) return;
  const extracted = extractMediaUrl(raw);
  if (!extracted) {
    showTip('未识别到合法的 URL 地址', 'error');
    return;
  }

  resolvingManual.value = true;
  try {
    // 1. 尝试平台解析器 (如 B站)
    const platformCandidates = await resolvePlatform(extracted);
    if (platformCandidates && platformCandidates.length > 0) {
      candidates.value.unshift(...platformCandidates);
      manualUrl.value = '';
      showTip(`解析成功，捕获 ${platformCandidates.length} 个视频`, 'success');
      return;
    }

    // 2. 通用链接解析
    const kind = mediaKind(extracted);
    if (!kind) throw new Error('请填写 MP4、WebM 或 M3U8 直链；网页链接请打开播放后嗅探');
    const newCand: VideoCandidate = {
      id: `manual_${Date.now()}`,
      url: extracted,
      title: '手动解析视频',
      sourceUrl: extracted,
      kind,
      capturedAt: Date.now()
    };
    candidates.value.unshift(newCand);
    manualUrl.value = '';
    showTip('已添加至下载列表', 'success');
  } catch (err: any) {
    showTip(`解析失败: ${err.message || '未知错误'}`, 'error');
  } finally {
    resolvingManual.value = false;
  }
}

async function startDownload(item: VideoCandidate) {
  progressMap.value[item.id] = {
    percentage: 0,
    speed: '准备中',
    stageText: '准备中',
    downloading: true
  };

  const onProg = (p: DownloadProgress) => {
    let stageText = '下载中';
    if (p.stage === 'preparing') stageText = '准备中';
    if (p.stage === 'paused') stageText = '已暂停';
    if (p.stage === 'cancelled') stageText = '已取消';
    if (p.stage === 'completed') stageText = '完成';
    if (p.stage === 'failed') stageText = '失败';

    progressMap.value[item.id] = {
      percentage: p.percentage,
      speed: p.speed,
      stageText,
      downloading: p.stage === 'preparing' || p.stage === 'downloading'
    };
  };

  try {
    if (item.kind === 'mp4' || item.kind === 'webm') {
      await downloadDirectMp4(item, onProg);
      await refreshDownloads();
      showTip('已发起下载！', 'success');
    } else if (item.kind === 'hls') {
      const preferred = selectedQualities.value[item.id];
      await downloadHlsStream(item, preferred, onProg);
      await refreshDownloads();
      showTip('已发起 HLS 后台下载！', 'success');
    }
  } catch (err: any) {
    progressMap.value[item.id] = {
      percentage: 0,
      speed: '0 B/s',
      stageText: '失败',
      downloading: false
    };
    showTip(`下载失败: ${err.message || '网络异常'}`, 'error');
  }
}

async function refreshDownloads() {
  try {
    const saved = (await chrome.storage.local.get('nativeDownloadTasks')).nativeDownloadTasks;
    if (saved) applyTaskSnapshot(saved);
    const response = await chrome.runtime.sendMessage({ type: 'GET_NATIVE_DOWNLOADS' });
    if (response?.error || !response?.tasks) throw new Error(response?.error || '后台未返回任务状态');
    applyTaskSnapshot(response.tasks);
    downloadSyncError.value = '';
  } catch (error) {
    downloadSyncError.value = `任务同步失败，已保留本地记录：${error instanceof Error ? error.message : String(error)}`;
  }
}
function applyTaskSnapshot(tasks: Record<string, NativeTask>) {
  for (const candidate of candidates.value) {
    const previous = taskForCandidate(candidate);
    if (previous && !tasks[previous.taskId]) delete progressMap.value[candidate.id];
  }
  for (const taskId of Object.keys(nativeTasks.value)) if (!tasks[taskId]) delete progressMap.value[taskId];
  nativeTasks.value = tasks;
  for (const task of Object.values(nativeTasks.value)) {
    progressMap.value[task.taskId] = {
      percentage: task.percentage,
      speed: task.errorMessage || (task.stage === 'completed' ? '已保存到本地' : 'Chrome 后台下载'),
      stageText: task.stage === 'queued' ? '排队中' : task.stage === 'resolving' ? '解析剧集' : task.stage === 'completed' ? '完成' : task.stage === 'failed' ? '失败' : task.stage === 'cancelled' ? '已取消' : task.stage === 'paused' ? '已暂停' : task.stage === 'preparing' ? '准备中' : task.phase === 'saving' ? '保存中' : '下载中',
      downloading: ['queued', 'resolving', 'preparing', 'downloading'].includes(task.stage)
    };
  }
  // A reloaded playback page gets new candidate IDs. Bind it to the existing
  // task by the network URL rather than inviting a duplicate download.
  for (const candidate of candidates.value) {
    const task = taskForCandidate(candidate);
    if (task && progressMap.value[task.taskId]) progressMap.value[candidate.id] = progressMap.value[task.taskId];
  }
}
function taskForCandidate(candidate: VideoCandidate) {
  try {
    const url = new URL(candidate.url); url.hash = '';
    return downloadTasks.value.find(task => task.candidate?.url === url.href);
  } catch { return undefined; }
}
function onTaskStorageChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
  if (area === 'local' && changes.nativeDownloadTasks) applyTaskSnapshot(changes.nativeDownloadTasks.newValue || {});
}
async function controlTask(task: NativeTask, action: string) {
  taskActionBusy.value[task.taskId] = true;
  try {
    // Call open directly from the click handler to preserve Chrome's user gesture.
    if (action === 'open' && task.downloadId !== undefined) { await chrome.downloads.open(task.downloadId); return; }
    if (action === 'show' && task.downloadId !== undefined) { chrome.downloads.show(task.downloadId); return; }
    const result = await chrome.runtime.sendMessage({ type: 'CONTROL_NATIVE_DOWNLOAD', taskId: task.taskId, action });
    if (result?.error) throw new Error(result.error);
    await refreshDownloads();
    if (action === 'remove') delete progressMap.value[task.taskId];
  } catch (error) {
    showTip(error instanceof Error ? error.message : '任务操作失败', 'error', 5000);
  } finally { taskActionBusy.value[task.taskId] = false; }
}
let downloadTimer: ReturnType<typeof setInterval>;
onMounted(() => {
  chrome.storage.onChanged.addListener(onTaskStorageChanged);
  loadTabCandidates();
  void restoreRangeDraft();
  void refreshDownloads().catch(console.error);
  downloadTimer = setInterval(() => { void refreshDownloads().catch(console.error); }, 1000);
});
onUnmounted(() => { clearTimeout(draftTimer); if (draftReady.value) void saveRangeDraft().catch(console.error); clearInterval(downloadTimer); chrome.storage.onChanged.removeListener(onTaskStorageChanged); });
</script>

<style scoped>
.page-tabs { display: grid; grid-template-columns: 1.1fr 1.05fr 0.85fr; gap: 4px; padding: 0 12px; background: #111827; border-bottom: 1px solid #1e293b; flex-shrink: 0; }
.meta-notice { margin: 0; padding: 8px 16px; color: #fbbf24; font-size: 12px; line-height: 1.5; }
.page-tabs button { border: 0; border-bottom: 2px solid transparent; background: transparent; color: #94a3b8; padding: 12px 3px; font-size: 12px; cursor: pointer; white-space: nowrap; }
.page-tabs button.active { color: #00dc82; border-bottom-color: #00dc82; }
.tab-count { display: inline-block; margin-left: 5px; padding: 1px 5px; border-radius: 4px; background: #1e293b; font-size: 10px; font-variant-numeric: tabular-nums; }
button:focus-visible, summary:focus-visible { outline: 2px solid #00dc82; outline-offset: 2px; }
.text-link:disabled { opacity: 0.45; cursor: default; }
.series-section { padding: 0; }
.range-field { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #cbd5e1; margin-bottom: 10px; }
.range-field input { width: 100%; box-sizing: border-box; background: #0b0f19; border: 1px solid #334155; border-radius: 6px; padding: 8px; color: #f1f5f9; font-size: 12px; outline: none; }
.range-field input:focus { border-color: #00dc82; }
.range-preview { width: 100%; }
.range-links { font-size: 11px; color: #94a3b8; margin: 10px 0; }
.range-links > div { overflow-wrap: anywhere; margin: 5px 0; }
.range-links[open] { max-height: 150px; overflow: auto; }
.series-title { font-weight: 600; font-size: 13px; margin: 8px 0; color: #e2e8f0; }
.series-tools { display: flex; align-items: center; gap: 14px; margin: 10px 0; font-size: 12px; color: #94a3b8; }
.episode-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; max-height: 190px; overflow: auto; margin-bottom: 12px; }
.episode-grid label { display: flex; align-items: center; gap: 4px; padding: 5px; background: #1e293b; border-radius: 6px; font-size: 12px; cursor: pointer; color: #e2e8f0; }
.episode-grid input { accent-color: #059669; }
.batch-start { width: 100%; }
.series-hint { color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 8px 0; }
.popup-container {
  display: flex;
  flex-direction: column;
  height: 580px;
  max-height: 100vh;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  flex-shrink: 0;
  background-color: #111827;
  border-bottom: 1px solid #1f2937;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #00dc82;
  box-shadow: 0 0 8px #00dc82aa;
}

.title {
  font-size: 16px;
  font-weight: 700;
  color: #f8fafc;
  letter-spacing: -0.3px;
}

.badge-tag {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: rgba(0, 220, 130, 0.15);
  color: #00dc82;
  font-weight: 600;
}

.manual-input-box {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  padding: 10px 16px;
  background: #131d2f;
  border-bottom: 1px solid #1e293b;
}

.manual-input-box input {
  flex: 1;
  background: #0b0f19;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  color: #f1f5f9;
  outline: none;
  transition: border-color 0.2s;
}

.manual-input-box input:focus {
  border-color: #00dc82;
}

.manual-input-box button {
  background: #1e293b;
  border: 1px solid #334155;
  color: #f8fafc;
  border-radius: 6px;
  padding: 0 12px;
  font-size: 12px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.manual-input-box button:hover:not(:disabled) {
  background: #334155;
  border-color: #475569;
}

.manual-input-box button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.tip-banner {
  flex-shrink: 0;
  padding: 6px 16px;
  font-size: 12px;
  text-align: center;
}
.tip-banner.info {
  background: #1e293b;
  color: #93c5fd;
}
.tip-banner.success {
  background: rgba(0, 220, 130, 0.15);
  color: #00dc82;
}
.tip-banner.error {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.content-body {
  padding: 12px 16px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.download-tasks { padding: 0; }

.task-error {
  color: #f87171;
  font-size: 11px;
  overflow-wrap: anywhere;
}

.task-notice { color: #94a3b8; font-size: 11px; overflow-wrap: anywhere; }
.version-tag { color: #94a3b8; font-size: 10px; }
.no-tasks { color: #64748b; font-size: 12px; padding: 12px 0; }
.task-actions { flex-wrap: wrap; }
.task-actions .btn { flex: 1 1 auto; }
.btn-danger { background: #ef444422; color: #f87171; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }

.section-title-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 10px;
  font-weight: 500;
}

.text-link {
  background: none;
  border: none;
  color: #00dc82;
  font-size: 12px;
  cursor: pointer;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
  color: #64748b;
}

.empty-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 11px;
  color: #475569;
  margin-top: 4px;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid #1e293b;
  border-top-color: #00dc82;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 10px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.candidate-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.candidate-card {
  background: #111827;
  border: 1px solid #1e293b;
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
}

.card-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.kind-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.kind-tag.hls {
  background: #f59e0b22;
  color: #f59e0b;
}

.kind-tag.mp4 {
  background: #3b82f622;
  color: #3b82f6;
}

.kind-tag.webm {
  background: #a855f722;
  color: #a855f7;
}

.video-title {
  font-size: 13px;
  font-weight: 600;
  color: #f1f5f9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.quality-selector {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #94a3b8;
}

.quality-selector select {
  background: #0b0f19;
  border: 1px solid #334155;
  color: #e2e8f0;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 11px;
  outline: none;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #64748b;
}

.url-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.progress-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
}

.progress-bar-bg {
  width: 100%;
  height: 4px;
  background: #1e293b;
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: #00dc82;
  transition: width 0.2s ease;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #94a3b8;
}

.card-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.btn {
  flex: 1;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn-secondary {
  background: #1e293b;
  color: #cbd5e1;
}

.btn-secondary:hover {
  background: #334155;
  color: #f8fafc;
}

.btn-primary {
  background: #00dc82;
  color: #0b0f19;
  font-weight: 600;
}

.btn-primary:hover:not(:disabled) {
  background: #05f08f;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
