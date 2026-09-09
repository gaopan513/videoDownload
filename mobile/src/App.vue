<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { harbor, native, type Candidate, type TaskView } from './bridge';
const url = ref(''), busy = ref(false), notice = ref(''), candidates = ref<Candidate[]>([]), tasks = ref<TaskView[]>([]);
const samples = [
  { name: '毒舌', url: 'https://www.dushe3.app/play/356989-41-4918517.html' },
  { name: '剧踪', url: 'https://www.juzong01.me/vodplay/60791-1-1/' },
  { name: '拾光', url: 'https://tv.time1080.xyz/play.php?source=qilin&id=27' }
];
const states: Record<string,string> = { queued:'等待下载', downloading:'下载中', paused:'已暂停', processing:'正在合并', waitingForeground:'等待前台合并', complete:'已完成', failed:'失败', cancelled:'已取消' };
let dispose: (() => void) | undefined;
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
    const checked = await harbor.inspect({ id: candidate.id });
    notice.value = checked.message;
    if (checked.codec === 'unsupported') return;
    const allowUnknown = checked.codec === 'unknown' && confirm('暂时无法确认视频和音轨编码。继续下载可能在最终检查时失败，仍要尝试吗？');
    if (checked.codec === 'unknown' && !allowUnknown) return;
    await harbor.add({ id: candidate.id, allowUnknown }); notice.value = '已加入队列';
  });
  busy.value = false;
}
async function control(t: TaskView, kind: 'pause'|'resume'|'cancel'|'retry') {
  if (kind === 'cancel' && !confirm('取消任务并删除已下载的临时数据？')) return;
  await action(() => harbor.control({ id:t.id, action:kind }));
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
    <section v-if="candidates.length" class="panel"><h2>发现的资源</h2><article v-for="c in candidates" :key="c.id" class="resource"><h3>{{ c.title }}</h3><p>{{ c.kind.toUpperCase() }} · {{ c.quality || '源画质' }}</p><p class="hint">{{ c.message }}</p><button :disabled="busy || c.codec === 'unsupported'" @click="add(c)">下载到手机</button></article></section>
    <section class="queue"><div class="section-heading"><h2>下载队列</h2><span>{{ tasks.length }} 个任务</span></div><div v-if="!tasks.length" class="empty"><span>↓</span><p>下载的视频会出现在这里</p><small>支持的 H.264 / AAC 视频将导出为 MP4</small></div>
      <article v-for="t in tasks" :key="t.id" class="panel task"><div class="section-heading"><h3>{{ t.title }}</h3><span>{{ states[t.state] || t.state }}</span></div><progress :value="t.done" :max="t.total || 1"/><p class="hint">{{ t.message }}</p><div class="buttons">
        <button v-if="['queued','downloading'].includes(t.state)" @click="control(t,'pause')">暂停</button><button v-if="t.state === 'paused'" @click="control(t,'resume')">继续</button><button v-if="t.state === 'failed'" @click="control(t,'retry')">重试</button><button v-if="!['complete','cancelled','processing'].includes(t.state)" @click="control(t,'cancel')">取消</button>
        <template v-if="t.state === 'complete'"><button class="primary" @click="action(() => harbor.exportFile({id:t.id,destination:'share'}))">分享 / 存储到文件</button><button @click="action(() => harbor.exportFile({id:t.id,destination:'photos'}))">存到相册</button></template>
      </div></article>
    </section><footer>锁屏下载由系统调度 · 回到前台完成合并</footer>
  </main>
</template>
