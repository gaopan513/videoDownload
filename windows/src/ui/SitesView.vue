<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { ImportItem, Site, SiteAdapter } from '../shared';
const api = window.harbor; const sites = ref<Site[]>([]); const preview = ref<ImportItem[]>([]); const replacements = ref<number[]>([]); const raw = ref(''); const notice = ref('');
const draft = ref<Site>({ id: '', name: '', url: '', adapter: 'none', enabled: true });
const adapters: { id: SiteAdapter; title: string }[] = [{ id: 'none', title: '未适配' }, { id: 'sotvla', title: 'SOTVLA 聚合' }, { id: 'dmxq', title: '模块型 vod' }, { id: 'dushe', title: '毒舌' }, { id: 'myui', title: 'Myui 播放列表' }];
function error(e: unknown) { return String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': Error: /, ''); }
async function save() { try { await api.saveSites(sites.value.map(site => ({ ...site }))); notice.value = '站点配置已保存'; } catch (e) { notice.value = error(e); sites.value = await api.sites(); } }
async function add() { const item = { ...draft.value, id: crypto.randomUUID() }; sites.value.push(item); await save(); draft.value = { id: '', name: '', url: '', adapter: 'none', enabled: true }; }
async function readImport(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; try { raw.value = await file.text(); preview.value = await api.previewSites(raw.value); replacements.value = []; } catch (e) { notice.value = error(e); } }
async function apply() { try { sites.value = await api.importSites(raw.value, replacements.value); preview.value = []; notice.value = '导入完成'; } catch (e) { notice.value = error(e); } }
async function exportSites() { try { const file = await api.exportSites(); if (file) notice.value = `已导出：${file}`; } catch (e) { notice.value = error(e); } }
async function visit(id: string) { try { await api.visitSite(id); notice.value = '站点窗口已打开，完成登录或验证后即可重试搜索'; } catch (e) { notice.value = error(e); } }
onMounted(async () => { sites.value = await api.sites(); });
</script>
<template>
  <div class="site-manager"><p v-if="notice" class="notice">{{ notice }}</p>
    <section class="panel site-results"><div class="section-heading"><h2>资源站点</h2><span>站点登录信息仅保留在应用会话中</span></div>
      <article v-for="site in sites" :key="site.id" class="site-edit"><input v-model="site.name" aria-label="站点名称"><input v-model="site.url" aria-label="站点入口"><select v-model="site.adapter" aria-label="站点适配器"><option v-for="adapter in adapters" :key="adapter.id" :value="adapter.id">{{ adapter.title }}</option></select><label><input v-model="site.enabled" type="checkbox">启用</label><button class="secondary" @click="visit(site.id)">访问</button><button class="secondary" @click="api.clearSiteLogin(site.id).then(() => notice = '登录状态已清除').catch(e => notice = error(e))">清除登录</button><button class="secondary" @click="sites = sites.filter(s => s.id !== site.id); save()">删除</button></article>
      <button class="primary" @click="save">保存站点</button>
    </section>
    <section class="panel site-results"><div class="section-heading"><h2>添加站点</h2><span>未知站点可保存为未适配</span></div><div class="site-edit"><input v-model="draft.name" placeholder="名称"><input v-model="draft.url" placeholder="https://example.com/"><select v-model="draft.adapter"><option v-for="adapter in adapters" :key="adapter.id" :value="adapter.id">{{ adapter.title }}</option></select><button class="primary" :disabled="!draft.name || !draft.url" @click="add">添加</button></div><p class="hint">已有适配器只适用于页面结构相同的站点。新站点要加入片名搜索和剧集下载，需要增加搜索、详情与播放规则；播放链接仍可直接粘贴到下载工作台尝试解析。</p></section>
    <section class="panel site-results"><div class="section-heading"><h2>导入与导出</h2><span>JSON 仅含站点配置</span></div><div class="site-import"><input type="file" accept="application/json,.json" @change="readImport"><button class="secondary" @click="exportSites">导出配置</button></div>
      <div v-for="item in preview" :key="item.index" class="import-row"><span>{{ item.site?.name || `第 ${item.index + 1} 项` }} · {{ { new: '新增', duplicate: '重复', conflict: '冲突', invalid: '无效' }[item.status] }} {{ item.reason }}</span><label v-if="item.status === 'conflict'"><input v-model="replacements" type="checkbox" :value="item.index">替换本地</label></div>
      <button v-if="preview.length" class="primary" @click="apply">应用导入</button>
    </section>
  </div>
</template>
