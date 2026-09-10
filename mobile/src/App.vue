<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { harbor, native, type Candidate, type TaskView, type OutputMode } from './bridge';
const outputMode = ref<OutputMode>('mp4'), deep = ref(false), retryModes = ref<Record<string,OutputMode>>({});
const modes: { value: OutputMode; label: string }[] = [{value:'mp4',label:'无损 MP4'}, {value:'mkv',label:'无损 MKV'}, {value:'transcode',label:'转码 MP4（H.264/AAC）'}];
const url = ref(''), busy = ref(false), notice = ref(''), candidates = ref<Candidate[]>([]), tasks = ref<TaskView[]>([]);
const samples = [
  { name: '毒舌', url: 'https://www.dushe3.app/play/356989-41-4918517.html' },
  { name: '剧踪', url: 'https://www.juzong01.me/vodplay/60791-1-1/' },
  { name: '拾光', url: 'https://tv.time1080.xyz/play.php?source=qilin&id=27' }
];
const states: Record<string,string> = { queued:'等待下载', downloading:'下载中', paused:'已暂停', processing:'正在合并', waitingForeground:'等待前台合并', complete:'已完成', failed:'失败', cancelled:'已取消' };
let dispose: (() => void) | undefined;
const deleting = ref<string[]>([]);
async function deleteRecord(t: TaskView) {
  if (deleting.value.includes(t.id) || !confirm('删除此记录？已完成的视频仍保留在手机中，可通过文件应用访问。')) return;
  deleting.value.push(t.id);
  try { await action(async () => {
    await harbor.deleteRecord({ id: t.id });
    tasks.value = (await harbor.snapshot()).tasks;
  }); } finally { deleting.value = deleting.value.filter(id => id !== t.id); }
}
async function action(fn: () => Promise<unknown>) { try { notice.value = ''; await fn(); } catch(e) { notice.value = e instanceof Error ? e.message : String(e); } }
async function resolve(interactive: boolean) {
  busy.value = true; candidates.value = [];
  await action(async () => { candidates.value = (await harbor.resolve({ url: url.value.trim(), interactive })).candidates; });
  busy.value = false;
}
async function add(candidate: Candidate) {
  busy.value = true;
  await action(async () => {
    notice.value = '正在检查视频与音轨编码…';
    const mode = outputMode.value;
    const checked = await harbor.inspect({ id: candidate.id, mode });
    notice.value = checked.message;
    if (checked.codec === 'unsupported') return;
    const allowUnknown = checked.codec === 'unknown' && confirm('暂时无法确认视频和音轨编码。继续下载可能在最终检查时失败，仍要尝试吗？');
    if (checked.codec === 'unknown' && !allowUnknown) return;
    await harbor.add({ id: candidate.id, allowUnknown, mode, deep: deep.value }); notice.value = '已加入队列';
  });
  busy.value = false;
}
async function control(t: TaskView, kind: 'pause'|'resume'|'cancel'|'retry') {
  if (kind === 'cancel' && !confirm('取消任务并删除已下载的临时数据？')) return;
  await action(() => harbor.control({ id:t.id, action:kind, ...(kind === 'retry' ? {mode:retryModes.value[t.id] || t.mode} : {}) }));
}
onMounted(() => { if (!native) return; void action(async () => {
  tasks.value = (await harbor.snapshot()).tasks;
  const listener = await harbor.addListener('tasks', data => { tasks.value = data.tasks; });
  dispose = () => { void listener.remove(); };
}); });
onUnmounted(() => dispose?.());
</script>
<template>
  <main>
    <header><span class="wordmark">StreamHarbor <b>↓</b></span><span class="badge">iPhone 原型</span></header>
    <h1>把视频带走。</h1><p class="intro">解析链接，下载到手机，再保存到文件或相册。</p>
    <p class="prototype">三站真机验收中 · 兼容性尚未确认</p>
    <p v-if="!native" class="notice">当前是界面预览。解析和下载需要在 iPhone 安装包中使用。</p>
    <section class="panel">
      <label for="url">视频网页或媒体链接</label>
      <textarea id="url" v-model="url" rows="3" placeholder="粘贴网页、MP4 或 M3U8 链接" spellcheck="false" :disabled="busy" />
      <div class="samples"><span>验收样本</span><button v-for="s in samples" :key="s.name" :disabled="busy" @click="url = s.url">{{ s.name }}</button></div>
      <div class="buttons"><button class="primary" :disabled="!native || busy || !url.trim()" @click="resolve(false)">{{ busy ? '正在识别…' : '解析链接' }}</button><button :disabled="!native || busy || !url.trim()" @click="resolve(true)">打开网页识别</button></div>
      <p class="hint">自动解析失败时，可打开网页手动播放，点击“完成识别”返回。</p>
    </section>
    <p v-if="notice" role="status" class="notice">{{ notice }}</p>
    <section v-if="candidates.length" class="panel"><h2>发现的资源</h2>
      <label for="output-mode">保存方式</label><select id="output-mode" v-model="outputMode" :disabled="busy"><option v-for="m in modes" :key="m.value" :value="m.value">{{ m.label }}</option></select>
      <p class="hint">{{ outputMode === 'transcode' ? '下载后在前台转为 H.264/AAC，耗时较长。' : outputMode === 'mkv' ? '保留原始编码，可分享或存储到文件；相册不支持 MKV。' : '保留原始编码。若不能封装为 MP4，可改选 MKV 或转码。' }}</p>
      <label class="verify-option"><input v-model="deep" type="checkbox" :disabled="busy">完成后逐帧解码校验（耗时更长）</label>
      <article v-for="c in candidates" :key="c.id" class="resource"><h3>{{ c.title }}</h3><p>{{ c.kind.toUpperCase() }} · {{ c.quality || '源画质' }}</p><p class="hint">{{ c.message }}</p><button :disabled="busy" @click="add(c)">下载到手机</button></article></section>
    <section class="queue"><div class="section-heading"><h2>下载队列</h2><span>{{ tasks.length }} 个任务</span></div><div v-if="!tasks.length" class="empty"><span>↓</span><p>下载的视频会出现在这里</p><small>无损保存 MP4 / MKV，或转码为 H.264 / AAC</small></div>
      <article v-for="t in tasks" :key="t.id" class="panel task"><div class="section-heading"><h3>{{ t.title }}</h3><span>{{ states[t.state] || t.state }}</span></div><progress :value="t.done" :max="t.total || 1"/><p class="hint">{{ t.message }}</p><div class="buttons">
        <button v-if="['queued','downloading'].includes(t.state)" @click="control(t,'pause')">暂停</button><button v-if="t.state === 'paused'" @click="control(t,'resume')">继续</button><button v-if="t.state === 'failed'" @click="control(t,'retry')">重试</button><button v-if="!['complete','cancelled','processing'].includes(t.state)" @click="control(t,'cancel')">取消</button>
        <select v-if="t.state === 'failed'" :value="retryModes[t.id] || t.mode" :aria-label="t.title + '重试输出方式'" @change="retryModes[t.id] = ($event.target as HTMLSelectElement).value as OutputMode"><option v-for="m in modes" :key="m.value" :value="m.value">{{ m.label }}</option></select>
        <template v-if="t.state === 'complete'"><button class="primary" @click="action(() => harbor.exportFile({id:t.id,destination:'share'}))">分享 / 存储到文件（{{ t.format.toUpperCase() }}）</button><button v-if="t.format === 'mp4'" @click="action(() => harbor.exportFile({id:t.id,destination:'photos'}))">存到相册</button></template>
        <button v-if="['complete','cancelled'].includes(t.state)" :disabled="deleting.includes(t.id)" @click="deleteRecord(t)">{{ deleting.includes(t.id) ? '正在删除…' : '删除记录' }}</button>
      </div></article>
    </section><footer>锁屏下载由系统调度 · 回到前台完成封装或转码</footer>
  </main>
</template>
