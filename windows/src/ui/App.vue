<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import appIcon from './assets/spiderweb.png';
import type { PublicCandidate, Settings, TaskView } from '../shared';
import SearchView from './SearchView.vue';
import SitesView from './SitesView.vue';
import './search.css';
import { isMetaVideoUrl } from '../../../extension/src/core/meta-media';
import { extractMediaUrl } from '../core/utils';
const tab = ref('downloads'), urls = ref(''), busy = ref(false), cancelled = ref(false), results = ref<PublicCandidate[]>([]), tasks = ref<TaskView[]>([]);
const api = window.harbor;
const selected = ref<string[]>([]), errors = ref<string[]>([]), notice = ref(''), tools = ref(''), current = ref('');
const settings = ref<Settings>({ directory: '', tasks: 2, concurrency: 8, proxy: '', deep: false });
const directory = ref(''); let off: (() => void) | undefined;
const metaLink = computed(() => urls.value.split(/\r?\n/).map(extractMediaUrl).find(isMetaVideoUrl));
const states: Record<string, string> = { queued: '等待下载', resolving: '解析剧集', choice: '选择资源', downloading: '正在下载', paused: '已暂停', merging: '处理媒体', confirm: '需要选择格式', complete: '下载完成', failed: '下载失败', cancelled: '已取消' };
const active = computed(() => tasks.value.filter(t => ['queued', 'downloading', 'merging'].includes(t.state)).length);
const done = computed(() => tasks.value.filter(t => t.state === 'complete').length);
const clearing = ref(false);
const deletingId = ref('');
async function deleteRecord(task: TaskView) {
  if (deletingId.value) return;
  deletingId.value = task.id;
  try { await action(async () => { const result = await api.deleteRecord(task.id); notice.value = result.cleanupFailed ? '记录已删除，临时分片清理失败' : task.output ? '记录已删除，视频文件已保留' : '记录已删除'; }); }
  finally { deletingId.value = ''; }
}
async function clearCompleted() {
  if (clearing.value) return;
  clearing.value = true;
  try { await action(async () => { const count = await api.clearCompleted(); notice.value = `已清除 ${count} 条完成记录，视频文件已保留`; }); }
  finally { clearing.value = false; }
}
const showTasks = computed(() => tab.value === 'complete' ? tasks.value.filter(t => t.state === 'complete') : tasks.value);
const errorText = (e: unknown) => String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': Error: /, '');
async function action(fn: () => Promise<unknown>, message = '') { try { await fn(); if (message) notice.value = message; } catch (e) { notice.value = errorText(e); } }
async function resolve() {
  errors.value = []; results.value = []; selected.value = []; busy.value = true; cancelled.value = false;
  const list = [...new Set(urls.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
  if (list.length > 30) { errors.value.push('一次最多解析 30 个网址，请分批提交'); busy.value = false; return; }
  for (let i = 0; i < list.length; i++) {
    if (cancelled.value) break;
    current.value = `正在解析 ${i + 1} / ${list.length}，动态网页可能需要约 45 秒`;
    try { const items = await window.harbor.resolve(list[i]); results.value.push(...items); if (items.length === 1) selected.value.push(items[0].id); }
    catch (e) { errors.value.push(`第 ${i + 1} 个网址：${errorText(e)}`); }
  }
  busy.value = false; current.value = '';
}
async function cancelResolve() { cancelled.value = true; await window.harbor.cancelResolve(); }
async function add() { for (const id of [...selected.value]) { try { await window.harbor.add(id, directory.value); selected.value = selected.value.filter(x => x !== id); notice.value = '已加入下载队列'; } catch (e) { notice.value = errorText(e); break; } } }
async function choose(isDefault = false) { const dir = await window.harbor.chooseDirectory(); if (dir) { if (isDefault) settings.value.directory = dir; else directory.value = dir; } }
async function control(task: TaskView, value: string) { if (value === 'cancel' && !confirm('取消任务并删除已下载的临时数据？')) return; if (value === 'restart' && !confirm('重新解析并从头下载？确认后将清除该任务已有分片。')) return; await action(() => window.harbor.control(task.id, value)); }
function size(n: number) { if (!n) return '0 B'; const u = Math.min(3, Math.floor(Math.log(n) / Math.log(1024))); return `${(n / 1024 ** u).toFixed(u ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][u]}`; }
function percent(t: TaskView) { return t.state === 'complete' ? 100 : t.total ? Math.min(100, t.done / t.total * 100) : 0; }
onMounted(async () => { try { const data = await window.harbor.init(); settings.value = data.settings; directory.value = data.settings.directory; tasks.value = data.tasks; tools.value = data.tools; off = window.harbor.onTasks(t => tasks.value = t); } catch (e) { notice.value = errorText(e); } });
onUnmounted(() => off?.());
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand"><img class="brand-icon" :src="appIcon" alt="" width="36" height="36"><div>StreamHarbor<small>视频下载工作台</small></div></div>
      <nav aria-label="主导航">
        <button :class="{ active: tab === 'downloads' }" @click="tab = 'downloads'"><span>⇣</span>下载工作台 <b>{{ tasks.length }}</b></button>
        <button :class="{ active: tab === 'search' }" @click="tab = 'search'"><span>⌕</span>搜索发现</button>
        <button :class="{ active: tab === 'sites' }" @click="tab = 'sites'"><span>▤</span>资源站点</button>
        <button :class="{ active: tab === 'complete' }" @click="tab = 'complete'"><span>✓</span>已完成 <b>{{ done }}</b></button>
        <button :class="{ active: tab === 'settings' }" @click="tab = 'settings'"><span>⚙</span>偏好设置</button>
      </nav>
      <div class="sidebar-bottom"><span class="status-dot"></span>文件保存在这台电脑<small>MP4 · HLS · AES-128<br>StreamHarbor / 1.0.1</small></div>
    </aside>
    <main>
      <header><div><p class="eyebrow">你的网页视频，归档到本地</p><h1>{{ { settings: '偏好设置', complete: '已完成', search: '搜索发现', sites: '资源站点', downloads: '下载工作台' }[tab] }}</h1></div><span class="activity"><i :class="{ running: active }"></i>{{ active ? `${active} 个任务进行中` : '就绪' }}</span></header>
      <div v-if="tools" class="alert" role="alert">{{ tools }}</div>
      <div v-if="notice" class="notice" role="status">{{ notice }}<button aria-label="关闭提示" @click="notice = ''">×</button></div>
      <SearchView v-show="tab === 'search'" :directory="directory" :active="tab === 'search'" />
      <SitesView v-if="tab === 'sites'" />
      <template v-if="tab === 'downloads'">
        <section class="capture panel">
          <div class="section-heading"><h2>添加视频链接</h2><span>网页 / 短视频 / MP4 / M3U8</span></div>
          <label for="urls" class="sr-only">视频网址，每行一个</label>
          <textarea id="urls" v-model="urls" placeholder="在这里粘贴视频网页、媒体链接或 App 分享口令（支持 YouTube/Instagram/Facebook/抖音/快手/B站/微博/小红书/西瓜等）…&#10;多个网址每行一个" :disabled="busy" spellcheck="false"></textarea>
          <div class="capture-footer"><span>{{ busy ? current : metaLink ? 'Instagram / Facebook：需要登录时，访问平台后重新解析。' : '自动发现媒体资源，再选择你要保存的视频。' }}</span><button v-if="metaLink && !busy" class="secondary" @click="action(() => api.visitMeta(metaLink!))">访问平台</button><button v-if="busy" class="secondary" @click="cancelResolve">停止解析</button><button v-else class="primary" :disabled="!urls.trim()" @click="resolve">解析链接 <span>→</span></button></div>
          <div v-if="busy" class="loading-line"></div>
          <div v-for="error in errors" :key="error" class="inline-error">{{ error }}</div>
        </section>
        <section v-if="results.length" class="panel candidates">
          <div class="section-heading"><h2>发现 {{ results.length }} 个资源</h2><span>选择视频与清晰度</span></div>
          <label v-for="c in results" :key="c.id" class="candidate"><input v-model="selected" type="checkbox" :value="c.id"><span class="format">{{ c.kind === 'hls' ? 'HLS' : c.kind === 'youtube' ? 'YouTube' : 'MP4' }}</span><div><strong>{{ c.title }}</strong><small>{{ c.source }}</small></div><span class="quality">{{ c.quality || '源画质' }}{{ c.audioName ? ` · ${c.audioName}` : '' }}</span></label>
          <div class="destination"><span>保存到</span><button class="path" :title="directory" @click="choose()">{{ directory || '选择下载目录' }} <span>▱</span></button><button class="primary" :disabled="!selected.length || !!tools" @click="add">下载所选 {{ selected.length || '' }}</button></div>
        </section>
      </template>
      <section v-if="tab === 'downloads' || tab === 'complete'" class="queue">
        <div class="section-heading"><h2>{{ tab === 'complete' ? '本地视频' : '下载队列' }} <span class="count">{{ showTasks.length }}</span></h2><button class="secondary" :disabled="!done || clearing" title="仅清除已完成的任务记录，保留本地视频文件" @click="clearCompleted">{{ clearing ? '正在清除…' : '清除完成记录' }}</button></div>
        <div v-if="!showTasks.length" class="empty"><div class="empty-mark">⇣</div><h3>{{ tab === 'complete' ? '还没有已完成的视频' : '下一段视频，从一个链接开始' }}</h3><p>解析链接后，下载进度和文件会显示在这里。</p><div class="empty-flow"><span>发现资源</span><i>→</i><span>下载分片</span><i>→</i><span>完整视频</span></div></div>
        <article v-for="t in showTasks" :key="t.id" class="task panel">
          <div class="task-top"><div class="media-icon">▶</div><div class="task-title"><h3>{{ t.title }}</h3><small>{{ t.kind === 'youtube' ? 'YouTube' : t.kind.toUpperCase() }} <span>·</span> {{ t.mode === 'mkv' ? 'MKV' : 'MP4' }} <span>·</span> {{ t.directory }}</small></div><span class="state" :class="t.state">{{ states[t.state] }}</span></div>
          <div class="track"><div :style="{ width: percent(t) + '%' }" :class="{ indeterminate: t.state === 'merging' }"></div></div>
          <div class="task-bottom"><span class="metric">{{ t.kind === 'hls' ? `${t.done} / ${t.total || '—'} 分片` : `${size(t.done)} / ${t.total ? size(t.total) : '未知大小'}` }}<span v-if="t.state === 'downloading'"> · {{ t.kind === 'hls' ? `${t.speed.toFixed(1)} 分片/秒` : `${size(t.speed)}/s` }}</span></span><div class="task-actions">
            <button v-if="['downloading', 'queued', 'merging'].includes(t.state)" @click="control(t, 'pause')">暂停</button>
            <button v-if="t.state === 'paused'" @click="control(t, 'resume')">继续</button>
            <template v-if="t.state === 'failed'"><button @click="control(t, 'retry')">重试</button><button @click="control(t, 'restart')">重新下载</button></template>
            <template v-if="t.state === 'confirm'"><button @click="control(t, 'transcode')">转码 MP4</button><button @click="control(t, 'mkv')">无损 MKV</button></template>
            <template v-if="t.state === 'choice'"><button v-for="c in t.choices" :key="c.id" @click="action(() => api.chooseCandidate(t.id, c.id))">{{ c.kind.toUpperCase() }} {{ c.quality || '源画质' }} {{ c.audioName || '' }}</button></template>
            <button v-if="!['complete', 'cancelled'].includes(t.state)" @click="control(t, 'cancel')">取消</button>
            <button v-if="['failed', 'paused', 'cancelled'].includes(t.state)" @click="control(t, 'clean')">清理分片</button>
            <button v-if="t.state === 'complete'" @click="action(() => api.openOutput(t.id))">打开文件位置 ↗</button>
            <button :disabled="!!deletingId" :title="t.state === 'complete' ? '仅删除记录，保留视频文件' : '停止任务并删除记录和临时分片'" @click="deleteRecord(t)">{{ deletingId === t.id ? '正在删除…' : '删除记录' }}</button>
          </div></div>
          <p v-if="t.message" class="task-message" :class="{ error: t.state === 'failed' }">{{ t.message }}</p>
        </article>
      </section>
      <section v-if="tab === 'settings'" class="panel settings">
        <h2>下载偏好</h2><label>默认保存目录<button class="path" @click="choose(true)">{{ settings.directory }} ▱</button></label>
        <div class="settings-row"><label>同时下载任务数<input v-model.number="settings.tasks" type="number" min="1" max="4"></label><label>每任务并发数<input v-model.number="settings.concurrency" type="number" min="1" max="16"></label></div>
        <label>手动代理<input v-model="settings.proxy" type="password" placeholder="留空使用系统代理；http:// 或 socks5://" autocomplete="off"></label><p class="hint">解析和下载共用此配置。请先暂停任务，再修改网络设置。</p>
        <label class="check"><input v-model="settings.deep" type="checkbox">下载后进行深度校验</label><p class="hint">逐帧检查视频，需要额外时间；默认执行媒体流和时长检查。</p>
        <button class="primary" @click="action(async () => { await api.saveSettings({ ...settings }); directory = settings.directory; }, '设置已保存')">保存设置</button>
        <div class="support-note"><h3>首版支持范围</h3><p>完整 MP4 与 M3U8 视频、HLS AES-128。网页需要登录、验证码或人工交互时可能无法解析。不支持直播录制和 DRM 保护资源。</p></div>
      </section>
    </main>
  </div>
</template>
