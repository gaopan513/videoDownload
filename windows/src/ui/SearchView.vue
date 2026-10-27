<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { SearchPage, SearchResult, Site, TitleDetail, WebSearchEngine } from '../shared';
const props = defineProps<{ directory: string; active: boolean }>();
const api = window.harbor; const sites = ref<Site[]>([]); const query = ref(''); const scope = ref<string[]>([]);
const webQuery = ref('');
const destination = ref(props.directory); watch(() => props.directory, value => destination.value = value);
watch(() => props.active, async active => { if (active) sites.value = await api.sites(); });
const pages = ref<Record<string, SearchPage>>({}); const status = ref<Record<string, string>>({}); const running = ref(false);
const pageNumbers = ref<Record<string, number>>({});
const searchedOrder = ref<string[]>([]);
const detail = ref<TitleDetail>(); const selectedKey = ref(''); const lineId = ref(''); const episodes = ref<string[]>([]); const notice = ref('');
const covers = ref<Record<string, string>>({}); const coverPending = new Set<string>();
let requestId = ''; let off: (() => void) | undefined; let batchId = ''; let submittedQuery = '';
const eligible = computed(() => sites.value.filter(s => s.enabled && s.adapter !== 'none'));
watch(eligible, values => {
  const ids = new Set(values.map(site => site.id));
  scope.value = scope.value.filter(id => ids.has(id));
  for (const id of Object.keys(status.value)) if (!ids.has(id)) { delete status.value[id]; delete pages.value[id]; delete pageNumbers.value[id]; }
  running.value = Object.values(status.value).some(value => value === '正在搜索…');
});
const orderedSites = computed(() => [...eligible.value].sort((a, b) => {
  const left = searchedOrder.value.indexOf(a.id), right = searchedOrder.value.indexOf(b.id);
  return (left < 0 ? Infinity : left) - (right < 0 ? Infinity : right);
}));
function error(e: unknown) { return String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': Error: /, ''); }
async function begin(siteId?: string, page = 1) {
  const keyword = siteId ? submittedQuery : query.value.trim();
  if (!keyword) return; if (!siteId) { submittedQuery = keyword; pages.value = {}; status.value = {}; pageNumbers.value = {}; detail.value = undefined; selectedKey.value = ''; }
  const available = eligible.value.map(site => site.id);
  scope.value = scope.value.filter(id => available.includes(id));
  const ids = siteId ? available.filter(id => id === siteId) : scope.value.length ? [...scope.value] : available;
  if (!ids.length) { requestId = ''; notice.value = '请先在资源站点启用至少一个已适配站点'; await stop(); return; }
  if (page === 1) { searchedOrder.value = [...ids, ...searchedOrder.value.filter(id => !ids.includes(id))]; if (siteId) { delete pages.value[siteId]; delete pageNumbers.value[siteId]; notice.value = `正在重试 ${sites.value.find(s => s.id === siteId)?.name || '站点'}…`; } else notice.value = ''; }
  for (const id of Object.keys(status.value)) if (status.value[id] === '正在搜索…') status.value[id] = '已取消';
  for (const id of ids) status.value[id] = '正在搜索…'; running.value = true; requestId = crypto.randomUUID();
  try { await api.search(keyword, ids, page, siteId, requestId); }
  catch (e) { notice.value = error(e); for (const id of ids) if (status.value[id] === '正在搜索…') status.value[id] = `重试失败：${error(e)}`; running.value = false; }
}
async function stop() { await api.cancelSearch(); running.value = false; for (const id of Object.keys(status.value)) if (status.value[id] === '正在搜索…') status.value[id] = '已取消'; }
async function open(item: SearchResult) { notice.value = ''; const key = `${item.siteId}:${item.id}`; if (selectedKey.value === key) { detail.value = undefined; selectedKey.value = ''; return; } try { const next = await api.detail({ ...item }); detail.value = next; selectedKey.value = key; lineId.value = next.lines[0]?.id || ''; episodes.value = []; batchId = crypto.randomUUID(); } catch (e) { notice.value = error(e); } }
async function loadCover(item: SearchResult) { if (!item.cover || covers.value[item.cover] || coverPending.has(item.cover)) return; coverPending.add(item.cover); try { covers.value[item.cover] = await api.cover(item.siteId, item.cover); } catch { covers.value[item.cover] = ''; } finally { coverPending.delete(item.cover); } }
function chooseLine(id: string) { lineId.value = id; episodes.value = []; }
const currentLine = computed(() => detail.value?.lines.find(l => l.id === lineId.value));
async function submit() { if (!detail.value || !episodes.value.length) return; try { const n = await api.batch(JSON.parse(JSON.stringify(detail.value)), lineId.value, [...episodes.value], destination.value, batchId); notice.value = n ? `已加入 ${n} 集下载队列` : '此批次已加入队列'; } catch (e) { notice.value = error(e); } }
async function chooseDirectory() { const value = await api.chooseDirectory(); if (value) destination.value = value; }
async function visit(id: string) { try { await api.visitSite(id); notice.value = '站点窗口已打开；完成登录或验证后返回并点击“完成并重试”'; } catch (e) { notice.value = error(e); } }
async function openWebSearch(engine: WebSearchEngine) { try { const filtered = await api.openWebSearch(engine, webQuery.value); notice.value = `${filtered ? '已加载广告过滤规则。' : '广告过滤规则暂不可用，启动时更新失败。'}搜索页已在应用窗口打开；打开视频页面后，从“网页”菜单复制当前网址，再粘贴到下载工作台`; } catch (e) { notice.value = error(e); } }
onMounted(async () => { sites.value = await api.sites(); off = api.onSearch(value => { if (value.requestId !== requestId || !eligible.value.some(site => site.id === value.siteId)) return; const old = pages.value[value.siteId]; if (value.result) { const unique = new Map((value.page > 1 ? old?.items || [] : []).map(x => [x.id, x])); value.result.items.forEach(x => { unique.set(x.id, x); void loadCover(x); }); pages.value[value.siteId] = { ...value.result, items: [...unique.values()] }; pageNumbers.value[value.siteId] = value.page; status.value[value.siteId] = unique.size ? `${unique.size} 条结果` : '无结果'; } else status.value[value.siteId] = value.error || '搜索失败'; if (notice.value.startsWith('正在重试')) notice.value = `${sites.value.find(s => s.id === value.siteId)?.name || '站点'}：${status.value[value.siteId]}`; running.value = Object.values(status.value).some(x => x === '正在搜索…'); }); });
onUnmounted(() => { off?.(); void api.cancelSearch(); });
</script>

<template>
  <div class="discover">
    <section class="panel web-search"><div class="section-heading"><h2>网页搜索</h2><span>找到视频页面后复制链接</span></div>
      <div class="discover-search"><input v-model="webQuery" aria-label="网页搜索内容" placeholder="输入关键词，也可留空打开搜索首页" maxlength="200" @keydown.enter="openWebSearch('google')"><button class="secondary" @click="openWebSearch('google')">Google 搜索</button><button class="secondary" @click="openWebSearch('duckduckgo')">DuckDuckGo 搜索</button></div>
      <p class="hint">在应用窗口中自行搜索，打开视频页面后从“网页”菜单复制当前网址，再粘贴到下载工作台解析。</p>
    </section>
    <section class="panel discovery-head"><div class="section-heading"><h2>跨站搜索</h2><span>覆盖已启用且已适配的站点</span></div>
      <div class="discover-search"><input v-model="query" placeholder="输入片名" @keydown.enter="begin()"><button class="primary" :disabled="!query.trim()" @click="begin()">搜索</button><button v-if="running" class="secondary" @click="stop">停止</button></div>
      <div class="site-filters"><label v-for="site in eligible" :key="site.id"><input v-model="scope" type="checkbox" :value="site.id">{{ site.name }}</label></div>
      <p class="hint">不勾选时搜索全部已适配站点；SOTVLA 匿名搜索可能不完整。毒舌需要页面验证时可打开站点窗口，完成后重试。</p>
    </section>
    <p v-if="notice" class="notice">{{ notice }}</p>
    <section v-for="site in orderedSites" :key="site.id" class="panel site-results"><div class="section-heading"><h2>{{ site.name }}</h2><span>{{ status[site.id] || '等待搜索' }}</span></div>
      <p v-if="status[site.id] && !pages[site.id]?.items.length" class="hint">{{ status[site.id] }}</p>
      <div v-for="item in pages[site.id]?.items" :key="item.id" class="result-entry"><div class="result-row"><img v-if="covers[item.cover]" :src="covers[item.cover]" alt=""><span v-else class="cover-placeholder" aria-hidden="true"></span><div><strong>{{ item.title }}</strong><small>{{ item.source }} · {{ item.year }} · {{ item.update }}</small></div><button class="secondary" @click="open(item)">{{ selectedKey === `${item.siteId}:${item.id}` ? '收起剧集' : '查看剧集' }}</button></div>
        <section v-if="detail && selectedKey === `${item.siteId}:${item.id}`" class="discovery-detail"><div class="section-heading"><h3>{{ detail.title }}</h3><button class="secondary" @click="detail = undefined; selectedKey = ''">收起</button></div>
          <div class="line-tabs"><button v-for="line in detail.lines" :key="line.id" :class="{ active: lineId === line.id }" @click="chooseLine(line.id)">{{ line.name }} · {{ line.episodes.length }} 集</button></div>
          <div class="episode-tools"><button class="secondary" @click="episodes = currentLine?.episodes.map(e => e.id) || []">全选</button><button class="secondary" @click="episodes = []">清空</button><span>已选 {{ episodes.length }} 集</span></div>
          <div class="episode-grid"><label v-for="ep in currentLine?.episodes" :key="ep.id"><input v-model="episodes" type="checkbox" :value="ep.id">{{ ep.name }}</label></div>
          <div class="destination"><span>保存到</span><button class="path" :title="destination" @click="chooseDirectory">{{ destination }} ▱</button><button class="primary" :disabled="!episodes.length" @click="submit">下载所选 {{ episodes.length }} 集</button></div>
        </section>
      </div>
      <div class="result-actions"><button v-if="status[site.id] && !status[site.id].includes('结果') && status[site.id] !== '无结果' && status[site.id] !== '正在搜索…'" class="secondary" @click="visit(site.id)">访问站点</button><button v-if="status[site.id] && !status[site.id].includes('结果') && status[site.id] !== '无结果'" class="secondary" :disabled="status[site.id] === '正在搜索…'" @click="begin(site.id)">{{ status[site.id] === '正在搜索…' ? '正在重试…' : '完成并重试' }}</button><button v-if="pages[site.id]?.hasMore" class="secondary" @click="begin(site.id, (pageNumbers[site.id] || 1) + 1)">加载更多</button></div>
    </section>
  </div>
</template>
