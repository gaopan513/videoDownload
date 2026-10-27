import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { BrowserWindow, type Session } from 'electron';
import { DownloadError, webUrl } from '../core/net';
import { abortable, fetchAt, readLimited } from './resolver';
import type { Episode, SearchPage, SearchResult, Site, SiteAdapter, TitleDetail } from '../shared';

export const defaults: Site[] = [
  { id: 'sotvla', name: 'SOTVLA', url: 'https://www.sotvla3.cc/', adapter: 'sotvla', enabled: true },
  { id: 'dmxq', name: '大米星球', url: 'https://dmxq0.com/', adapter: 'dmxq', enabled: true },
  { id: 'dushe', name: '毒舌', url: 'https://dushe3.app/', adapter: 'dushe', enabled: true },
  { id: 'lvsc', name: '绿色影视', url: 'https://www.lvsc168.com/', adapter: 'myui', enabled: true },
  { id: 'didahd', name: '嘀嗒影视', url: 'https://www.didahd.xyz/', adapter: 'myui', enabled: true }
];
const adapters: SiteAdapter[] = ['sotvla', 'dmxq', 'dushe', 'myui', 'none'];
const absolute = (href: string, base: string) => webUrl(new URL(href, base).href).href;
const text = (value: string) => value.replace(/\s+/g, ' ').trim();
const coverUrl = (value: string, base: string) => { try { return value ? absolute(value, base) : ''; } catch { return ''; } };
const titleKey = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
export function relevantResults(page: SearchPage, query: string): SearchPage {
  const needle = titleKey(query);
  return { ...page, items: needle ? page.items.filter(item => titleKey(item.title).includes(needle)) : page.items };
}
export function validateSite(value: unknown): Site {
  const s = value as Partial<Site>;
  if (!s || typeof s !== 'object' || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 100 || typeof s.url !== 'string' || typeof s.enabled !== 'boolean' || !adapters.includes(s.adapter as SiteAdapter)) throw new DownloadError('SITE', '站点配置格式无效');
  const u = webUrl(s.url); if (u.pathname !== '/' || u.search || u.hash) throw new DownloadError('SITE', '站点入口须为网站根地址');
  return { id: typeof s.id === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(s.id) ? s.id : randomUUID(), name: s.name.trim(), url: u.origin + '/', adapter: s.adapter!, enabled: s.enabled };
}
export async function loadSites(file: string): Promise<Site[]> {
  try { const data = JSON.parse(await readFile(file, 'utf8')); if (data.version !== 1 || !Array.isArray(data.sites)) throw new Error('version');
    const retained = (data.sites as { id?: string; url?: string; adapter?: string }[]).filter(value => value?.id !== 'pianku' && value?.url !== 'https://4k01.pianku.online/' && value?.id !== 'libvio' && value?.url !== 'https://www.libvio.io/');
    const sites: Site[] = retained.map(value => validateSite(value.adapter === 'pianku' || value.adapter === 'stui' ? { ...value, adapter: 'none' } : value));
    if (data.catalogVersion !== 4 || retained.length !== data.sites.length || retained.some(value => value.adapter === 'pianku' || value.adapter === 'stui')) {
      if (data.catalogVersion !== 2 && data.catalogVersion !== 3 && data.catalogVersion !== 4) for (const site of defaults.slice(3)) if (!sites.some(old => old.id === site.id || old.url === site.url)) sites.push(site);
      await saveSites(file, sites);
    }
    return sites; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') { await saveSites(file, defaults); return structuredClone(defaults); } throw new DownloadError('SITE', '站点配置无法读取，请检查 sites.json；原文件未被覆盖'); }
}
export async function saveSites(file: string, sites: Site[]) {
  const normalized = sites.map(validateSite);
  if (new Set(normalized.map(s => s.id)).size !== normalized.length || new Set(normalized.map(s => s.url)).size !== normalized.length) throw new DownloadError('SITE', '站点 ID 或入口地址重复');
  await writeFile(file + '.new', JSON.stringify({ version: 1, catalogVersion: 4, sites: normalized }, null, 2)); await rename(file + '.new', file);
}
export function previewImport(raw: string, local: Site[]) {
  if (raw.length > 1024 * 1024) throw new DownloadError('SITE', '导入文件过大');
  let values: unknown; try { const parsed = JSON.parse(raw); values = parsed.version === 1 ? parsed.sites : undefined; } catch { throw new DownloadError('SITE', '导入文件不是有效 JSON'); }
  if (!Array.isArray(values) || values.length > 200) throw new DownloadError('SITE', '站点文件版本或条目数量无效');
  const seen = new Set<string>();
  return values.map((value, index) => { try { const site = validateSite(value); if (seen.has(site.id) || seen.has(site.url)) return { index, site, status: 'duplicate' as const }; seen.add(site.id); seen.add(site.url); const old = local.find(s => s.id === site.id || s.url === site.url); return { index, site, status: old ? (old.name === site.name && old.adapter === site.adapter && old.enabled === site.enabled ? 'duplicate' as const : 'conflict' as const) : 'new' as const, localId: old?.id }; } catch (e) { return { index, status: 'invalid' as const, reason: (e as Error).message }; } });
}
export function applyImport(local: Site[], preview: ReturnType<typeof previewImport>, replace: number[]) {
  const next = [...local]; for (const item of preview) { if (!item.site || item.status === 'duplicate') continue; if (item.status === 'conflict') { if (!replace.includes(item.index)) continue; const i = next.findIndex(s => s.id === item.localId); if (i >= 0) next.splice(i, 1); } if (!next.some(s => s.id === item.site!.id || s.url === item.site!.url)) next.push(item.site); } return next;
}
async function html(ses: Session, url: string, signal: AbortSignal) {
  const response = await fetchAt(ses, url, { signal, headers: { accept: 'text/html', referer: new URL(url).origin + '/' } });
  if (response.status === 401 || response.status === 403 || response.status === 429) throw new DownloadError('ACCESS', '访问受限，请打开站点完成登录或验证');
  if (!response.ok) throw new DownloadError('HTTP', `站点返回 HTTP ${response.status}`);
  const body = await readLimited(response, 4 * 1024 * 1024, signal);
  if (/captcha|人机验证|访问验证/i.test(body.slice(0, 4000)) && body.length < 15000) throw new DownloadError('ACCESS', '站点要求人工验证');
  return { body, url: response.url };
}
export function isCloudflareChallenge(body: string): boolean {
  const $ = cheerio.load(body);
  return $('script[src*="/cdn-cgi/challenge-platform/"][src*="/orchestrate/chl_page/"]').length > 0 || $('script').toArray().some(el => /window\._cf_chl_opt\s*=/.test($(el).html() || ''));
}
async function browserHtml(ses: Session, url: string, signal: AbortSignal, settleMs = 800) {
  const browser = new BrowserWindow({ show: false, width: 1100, height: 820, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, disableDialogs: true } });
  browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const abort = () => { if (!browser.isDestroyed()) browser.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    await abortable(browser.loadURL(url), signal); await abortable(new Promise(resolve => setTimeout(resolve, settleMs)), signal);
    const deadline = Date.now() + 10000;
    for (;;) {
      signal.throwIfAborted();
      const snapshot = await abortable(browser.webContents.executeJavaScript('({ body: document.documentElement.outerHTML, url: location.href })', true), signal);
      const body: unknown = snapshot?.body, actual: unknown = snapshot?.url;
      if (typeof actual !== 'string' || !actual || /baidu\.com|captcha|verify/i.test(actual)) throw new DownloadError('ACCESS', '站点要求人工验证，请打开站点访问窗口');
      if (typeof body !== 'string' || body.length > 4 * 1024 * 1024) throw new DownloadError('LIMIT', '站点页面过大或无法读取');
      if (isCloudflareChallenge(body)) {
        if (Date.now() >= deadline) throw new DownloadError('ACCESS', '站点安全验证尚未完成，请打开“访问站点”完成验证后重试');
        await abortable(new Promise(resolve => setTimeout(resolve, 500)), signal);
        continue;
      }
      if (/Protected by cdndefend|人机验证/.test(body.slice(0, 5000))) throw new DownloadError('ACCESS', '站点要求人工验证，请打开站点访问窗口');
      return { body, url: actual };
    }
  } finally { signal.removeEventListener('abort', abort); abort(); }
}
export function parseSotvlaSearch(body: string, base: string, site: Site, page = 1): SearchPage {
  const state = /window\.SOTV_SEARCH_PROGRESS\s*=\s*(\{[^\n]*\});/.exec(body);
  if (state) {
    try {
      const data = JSON.parse(state[1]) as { items: Record<string, unknown>[]; perPage: number; continuation?: unknown };
      if (Array.isArray(data.items)) {
        const per = Number.isInteger(data.perPage) && data.perPage > 0 ? data.perPage : 16;
        const items = data.items.slice((page - 1) * per, page * per).flatMap(item => {
          try {
            const api = String(item._api_id || ''), vod = String(item.vod_id || ''); if (!api || !vod) return [];
            const url = new URL('/detail.php', base); url.searchParams.set('api_id', api); url.searchParams.set('vod_id', vod);
            return [{ id: `${api}:${vod}`, siteId: site.id, title: String(item.vod_name || ''), url: url.href, cover: coverUrl(String(item.vod_pic || ''), base), year: String(item.vod_year || ''), update: String(item.vod_serial || item.vod_total || ''), source: String(item._api_name || site.name) }];
          } catch { return []; }
        });
        return { siteId: site.id, items, hasMore: page * per < data.items.length || !!data.continuation };
      }
    } catch {}
  }
  const $ = cheerio.load(body); const items: SearchResult[] = []; const seen = new Set<string>();
  $('a.sr-title[href*="detail.php"]').each((_, el) => { const href = $(el).attr('href') || ''; try { const url = absolute(href, base), u = new URL(url), api = u.searchParams.get('api_id'), vod = u.searchParams.get('vod_id'); if (!api || !vod) return; const key = `${api}:${vod}`; if (seen.has(key)) return; seen.add(key); const card = $(el).closest('.sr-item,.sr-card,.search-result,.sr-row'); const root = card.length ? card : $(el).parent().parent(); const title = text($(el).text()); if (!title) return; seen.add(key); items.push({ id: key, siteId: site.id, title, url, cover: coverUrl(root.find('img').first().attr('data-src') || root.find('img').first().attr('src') || '', base), year: text(root.find('.sr-meta-cell').first().text()), update: text(root.find('.sr-line').first().text()), source: text(root.find('.sr-source-line').text()) || site.name }); } catch {} });
  const per = 16; return { siteId: site.id, items: items.slice((page - 1) * per, page * per), hasMore: page * per < items.length };
}
export function parseSotvlaDetail(body: string, base: string, result: SearchResult): TitleDetail {
  const $ = cheerio.load(body); const lines = $('[data-src-panel]').toArray().map((panel, i) => { const src = $(panel).attr('data-src-panel') || String(i); const name = text($(`.play-source-tab[data-src="${src}"]`).first().text()) || `线路 ${i + 1}`; const episodes: Episode[] = []; $(panel).find('a.play-ep-pill[href*="play.php"]').each((_, el) => { try { episodes.push({ id: `${src}:${episodes.length}`, name: text($(el).text()) || `第 ${episodes.length + 1} 集`, url: absolute($(el).attr('href')!, base) }); } catch {} }); return { id: src, name, episodes }; }).filter(x => x.episodes.length);
  if (!lines.length) throw new DownloadError('STRUCTURE', '该来源暂无可用剧集，请尝试同片名的其他来源'); return { ...result, lines };
}
export function parseDmxqSearch(body: string, base: string, site: Site): SearchPage {
  const $ = cheerio.load(body); const seen = new Set<string>(); const items: SearchResult[] = [];
  $('a[href*="/voddetail/"]').each((_, el) => { try { const url = absolute($(el).attr('href')!, base), id = /\/voddetail\/(\d+)/.exec(new URL(url).pathname)?.[1]; if (!id || seen.has(id)) return; const card = $(el).closest('.module-card-item,.module-search-item,.module-item,.module-card'); const root = card.length ? card : $(el).parent(); const title = text(root.find('.module-card-item-title,.module-item-title,.module-card-item-name').first().text()) || text($(el).attr('title') || $(el).text()); if (!title) return; seen.add(id); items.push({ id, siteId: site.id, title, url, cover: coverUrl(root.find('img').first().attr('data-original') || root.find('img').first().attr('data-src') || '', base), year: text(root.find('.module-info-item').first().text()), update: text(root.find('.module-item-note,.module-card-item-note').first().text()), source: site.name }); } catch {} });
  return { siteId: site.id, items, hasMore: $('a[href*="vodsearch/"][href*="---"]').length > 0 || $('.page-next,.module-page a:contains("下一页")').length > 0 };
}
export function parseDmxqDetail(body: string, base: string, result: SearchResult): TitleDetail {
  const $ = cheerio.load(body); const lists = $('.module-play-list,.module-player-list,.playlist').toArray();
  const lines = lists.map((list, i) => { const episodes: Episode[] = []; $(list).find('a[href*="vodplay"]').each((_, el) => { try { episodes.push({ id: `${i}:${episodes.length}`, name: text($(el).text()) || `第 ${episodes.length + 1} 集`, url: absolute($(el).attr('href')!, base) }); } catch {} }); const name = text($('.module-tab-item,.module-player-tab .module-tab-item').eq(i).text()) || `线路 ${i + 1}`; return { id: String(i), name, episodes }; }).filter(line => line.episodes.length);
  if (!lines.length) throw new DownloadError('STRUCTURE', '详情页播放线路结构已变化'); return { ...result, lines };
}
export function parseDusheSearch(body: string, base: string, site: Site, page: number): SearchPage {
  const $ = cheerio.load(body); const items: SearchResult[] = []; const seen = new Set<string>();
  $('a.search-result-item[href*="/detail/"]').each((_, el) => { try { const url = absolute($(el).attr('href')!, base); const id = /\/detail\/(\d+)\.html/.exec(new URL(url).pathname)?.[1]; if (!id || seen.has(id)) return; const title = text($(el).find('.title').first().text()); if (!title) return; seen.add(id); const cover = coverUrl($(el).find('img').first().attr('data-src') || $(el).find('img').first().attr('src') || '', base); const tags = $(el).find('.tags').first(); items.push({ id, siteId: site.id, title, url, cover, year: text(tags.find('span').first().text()), update: text($(el).find('.status,.note,.update').first().text()), source: site.name }); } catch {} });
  const hasMore = $('a.page-item-next[href]').toArray().some(el => Number(new URL($(el).attr('href')!, base).searchParams.get('page')) > page);
  return { siteId: site.id, items, hasMore };
}
export function parseDusheDetail(body: string, base: string, result: SearchResult): TitleDetail {
  const $ = cheerio.load(body); const tabs = $('.detail-play-box .source-item').toArray(); const lists = $('.detail-play-box .episode-list').toArray();
  const lines = lists.map((list, i) => { const episodes: Episode[] = []; $(list).find('a.episode-item[href*="/play/"]').each((_, el) => { try { episodes.push({ id: `${i}:${episodes.length}`, name: text($(el).text()) || `第 ${episodes.length + 1} 集`, url: absolute($(el).attr('href')!, base) }); } catch {} }); return { id: String(i), name: text($(tabs[i]).find('.source-item-label').text()) || `线路 ${i + 1}`, episodes }; }).filter(line => line.episodes.length);
  if (!lines.length || lines.length !== tabs.length) throw new DownloadError('STRUCTURE', '毒舌详情页线路结构已变化'); return { ...result, lines };
}
const templateAdapters: SiteAdapter[] = ['myui'];
function searchForm(body: string, base: string, query: string) {
  const $ = cheerio.load(body);
  const form = $('form').toArray().find(el => $(el).find('input[name="wd"],input[name="searchword"]').length);
  if (!form) throw new DownloadError('STRUCTURE', '站点搜索表单结构已变化');
  const field = $(form).find('input[name="wd"],input[name="searchword"]').first().attr('name')!;
  const action = $(form).attr('action') || base;
  const url = new URL(action, base); url.searchParams.set(field, query);
  return url.href;
}
function nextSearchUrl(body: string, base: string) {
  const $ = cheerio.load(body);
  const link = $('a[href]').toArray().find(el => /^(下一页|下页|›|»|Next)$/i.test(text($(el).text())) || $(el).hasClass('page-next'));
  if (!link) return undefined;
  try {
    const url = absolute($(link).attr('href')!, base); const next = new URL(url);
    const lastLink = $('a[href]').toArray().find(el => /^(尾页|末页|最后一页)$/i.test(text($(el).text())));
    if (lastLink) { const last = new URL($(lastLink).attr('href')!, base); const nextPage = Number(next.searchParams.get('page')); const lastPage = Number(last.searchParams.get('page')); if (nextPage > 0 && lastPage > 0 && nextPage > lastPage) return undefined; }
    return next.origin === new URL(base).origin && url !== base ? url : undefined;
  } catch { return undefined; }
}
export function parseTemplateSearch(body: string, base: string, site: Site): SearchPage {
  const $ = cheerio.load(body); const items: SearchResult[] = []; const seen = new Set<string>();
  const pattern = /\/(?:detail|movie)\/(\d+)\.html$/;
  const selector = 'a[href*="/detail/"],a[href*="/movie/"]';
  $(selector).each((_, el) => { try {
    const url = absolute($(el).attr('href')!, base); const id = pattern.exec(new URL(url).pathname)?.[1]; if (!id || seen.has(id)) return;
    const root = $(el).closest('li.clearfix,.myui-vodlist__box,.myui-vodlist__media');
    const title = text($(el).attr('title') || root.find('.title a,.title').first().text() || $(el).text()); if (!title) return;
    seen.add(id);
    const cover = coverUrl(root.find('[data-original]').first().attr('data-original') || root.find('img').first().attr('data-src') || root.find('img').first().attr('src') || '', base);
    items.push({ id, siteId: site.id, title, url, cover, year: text(root.find('.subtitle').first().text()).match(/\b(?:19|20)\d{2}\b/)?.[0] || '', update: text(root.find('.remarks,.pic-text').first().text()), source: site.name });
  } catch {} });
  return { siteId: site.id, items, hasMore: !!nextSearchUrl(body, base) };
}
export function parseTemplateDetail(body: string, base: string, result: SearchResult, adapter: SiteAdapter): TitleDetail {
  const $ = cheerio.load(body);
  if (adapter === 'myui') {
    const groups = new Map<string, Episode[]>();
    $('ul.myui-content__list a[href*="/play/"],.tab-pane[id^="playlist"] a[href*="/play/"]').each((_, el) => { try {
      const url = absolute($(el).attr('href')!, base); const match = /^\/play\/(\d+)-(\d+)-(\d+)\.html$/.exec(new URL(url).pathname);
      if (!match || match[1] !== result.id) return;
      const episodes = groups.get(match[2]) || []; if (episodes.some(item => item.url === url)) return;
      episodes.push({ id: `${match[2]}:${episodes.length}`, name: text($(el).text()) || `第 ${episodes.length + 1} 集`, url }); groups.set(match[2], episodes);
    } catch {} });
    const lines = [...groups].map(([id, episodes], i) => ({ id, name: `线路 ${i + 1}`, episodes }));
    if (!lines.length) throw new DownloadError('STRUCTURE', 'Myui 播放列表结构已变化'); return { ...result, lines };
  }
  throw new DownloadError('SITE', '该站点尚未适配');
}
export async function searchSite(site: Site, ses: Session, query: string, page: number, signal: AbortSignal): Promise<SearchPage> {
  if (site.adapter === 'none') throw new DownloadError('SITE', '该站点未适配');
  if (templateAdapters.includes(site.adapter)) {
    const home = await browserHtml(ses, site.url, signal); const url = searchForm(home.body, home.url, query);
    let response = await browserHtml(ses, url, signal);
    for (let current = 1; current < page; current++) { const next = nextSearchUrl(response.body, response.url); if (!next) return { siteId: site.id, items: [], hasMore: false }; const prior = parseTemplateSearch(response.body, response.url, site); const following = await browserHtml(ses, next, signal); const nextPage = parseTemplateSearch(following.body, following.url, site); if (prior.items.length && prior.items.map(item => item.id).join('\0') === nextPage.items.map(item => item.id).join('\0')) return { siteId: site.id, items: [], hasMore: false }; response = following; }
    const parsed = parseTemplateSearch(response.body, response.url, site);
    if (page === 1 && !parsed.items.length && /\/(?:detail|movie|voddetail)\//.test(response.body)) throw new DownloadError('STRUCTURE', '搜索页结构已变化');
    return relevantResults({ ...parsed, hasMore: parsed.hasMore && parsed.items.length > 0 }, query);
  }
  if (site.adapter === 'dushe') {
    const home = await browserHtml(ses, site.url, signal); const $ = cheerio.load(home.body); const form = $('form[action*="/search"]').first(); const action = form.attr('action'); const token = form.find('input[name="t"]').attr('value');
    if (!action || !token) throw new DownloadError('STRUCTURE', '毒舌搜索表单结构已变化');
    const url = new URL(action, home.url); url.searchParams.set('k', query); url.searchParams.set('t', token); if (page > 1) url.searchParams.set('page', String(page));
    const response = await browserHtml(ses, url.href, signal); return relevantResults(parseDusheSearch(response.body, response.url, site, page), query);
  }
  let url: string;
  if (site.adapter === 'sotvla') { url = new URL('/search.php', site.url).href; const u = new URL(url); u.searchParams.set('q', query); u.searchParams.set('page', String(page)); url = u.href; }
  else url = new URL(`/vodsearch/${encodeURIComponent(query)}----------${page}---.html`, site.url).href;
  const response = await html(ses, url, signal); const parsed = site.adapter === 'sotvla' ? parseSotvlaSearch(response.body, response.url, site, page) : parseDmxqSearch(response.body, response.url, site);
  if (page === 1 && !parsed.items.length && /voddetail|detail.php/.test(response.body)) throw new DownloadError('STRUCTURE', '搜索页结构已变化');
  return relevantResults({ ...parsed, hasMore: parsed.hasMore && parsed.items.length > 0 }, query);
}
export async function getDetail(site: Site, ses: Session, result: SearchResult, signal: AbortSignal): Promise<TitleDetail> {
  if (templateAdapters.includes(site.adapter)) { if (new URL(result.url).origin !== new URL(site.url).origin) throw new DownloadError('SITE', '详情地址与站点入口不一致'); const response = await browserHtml(ses, result.url, signal); return parseTemplateDetail(response.body, response.url, result, site.adapter); }
  if (site.adapter === 'dushe') { const home = await browserHtml(ses, site.url, signal); if (new URL(result.url).origin !== new URL(home.url).origin) throw new DownloadError('SITE', '详情地址与站点入口不一致'); const response = await browserHtml(ses, result.url, signal); return parseDusheDetail(response.body, response.url, result); }
  if (new URL(result.url).origin !== new URL(site.url).origin) throw new DownloadError('SITE', '详情地址与站点入口不一致');
  const response = await html(ses, result.url, signal);
  if (site.adapter === 'sotvla') return parseSotvlaDetail(response.body, response.url, result);
  if (site.adapter === 'dmxq') return parseDmxqDetail(response.body, response.url, result);
  throw new DownloadError('SITE', '该站点尚未适配');
}
