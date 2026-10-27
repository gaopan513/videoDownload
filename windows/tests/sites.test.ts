import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyImport, isCloudflareChallenge, loadSites, parseDmxqDetail, parseDusheDetail, parseDusheSearch, parseSotvlaDetail, parseSotvlaSearch, parseTemplateDetail, parseTemplateSearch, previewImport, relevantResults, saveSites } from '../src/main/sites';
import { webSearchUrl } from '../src/main/web-search';
import type { SearchResult, Site } from '../src/shared';

const site: Site = { id: 'sotvla', name: 'SOTVLA', url: 'https://www.sotvla3.cc/', adapter: 'sotvla', enabled: true };
test('Cloudflare interstitials are recognized even after long styles, ordinary pages remain readable', () => {
  const style = `<style>${'body{color:#333}'.repeat(500)}</style>`;
  assert.equal(isCloudflareChallenge(`<html><head>${style}<script>window._cf_chl_opt = { cType: 'managed' };</script></head><body>正在进行安全验证</body></html>`), true);
  assert.equal(isCloudflareChallenge('<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>'), true);
  assert.equal(isCloudflareChallenge('<form action="/search.php"><input name="searchword"></form><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>'), false);
  assert.equal(isCloudflareChallenge('<form action="/search.php"><input name="searchword"></form><script src="/cdn-cgi/challenge-platform/scripts/jsd/api.js"></script>'), false);
  assert.equal(isCloudflareChallenge('<form action="/search/-------------.html"><input name="wd"></form><div>剧情：人机验证</div>'), false);
});
test('site config survives deletion of defaults and malformed imports do not overwrite it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'harbor-sites-')); const file = path.join(dir, 'sites.json');
  try {
    assert.equal((await loadSites(file)).length, 5);
    await saveSites(file, []); assert.deepEqual(await loadSites(file), []);
    const original = await readFile(file, 'utf8');
    assert.throws(() => previewImport('{invalid', []));
    assert.equal(await readFile(file, 'utf8'), original);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('existing site config receives new catalog entries once and retains deletions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'harbor-site-migration-')); const file = path.join(dir, 'sites.json');
  try {
    await writeFile(file, JSON.stringify({ version: 1, sites: [site] }));
    const migrated = await loadSites(file); assert.deepEqual(migrated.map(x => x.id), ['sotvla', 'lvsc', 'didahd']);
    await saveSites(file, migrated.filter(x => x.id !== 'lvsc'));
    assert.equal((await loadSites(file)).some(x => x.id === 'lvsc'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('retired Pianku and LibVio config is removed; old custom adapters become unadapted', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'harbor-retired-site-')); const file = path.join(dir, 'sites.json');
  try {
    await writeFile(file, JSON.stringify({ version: 1, catalogVersion: 3, sites: [site, { id: 'pianku', name: '片库', url: 'https://4k01.pianku.online/', adapter: 'pianku', enabled: true }, { id: 'libvio', name: 'LibVio', url: 'https://www.libvio.io/', adapter: 'stui', enabled: true }, { id: 'custom', name: '自定义', url: 'https://example.com/', adapter: 'stui', enabled: true }] }));
    const loaded = await loadSites(file);
    assert.deepEqual(loaded.map(x => [x.id, x.adapter]), [['sotvla', 'sotvla'], ['custom', 'none']]);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).catalogVersion, 4);
    assert.equal(previewImport(JSON.stringify({ version: 1, sites: [{ id: 'old', name: '片库', url: 'https://4k01.pianku.online/', adapter: 'pianku', enabled: true }] }), loaded)[0].status, 'invalid');
    assert.equal(previewImport(JSON.stringify({ version: 1, sites: [{ id: 'old', name: 'LibVio', url: 'https://www.libvio.io/', adapter: 'stui', enabled: true }] }), loaded)[0].status, 'invalid');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('manual web search opens only the selected engine with encoded keywords', () => {
  assert.equal(webSearchUrl('google', '年会不能停 2'), 'https://www.google.com/search?q=%E5%B9%B4%E4%BC%9A%E4%B8%8D%E8%83%BD%E5%81%9C+2');
  assert.equal(webSearchUrl('duckduckgo', '年会不能停 2'), 'https://duckduckgo.com/?q=%E5%B9%B4%E4%BC%9A%E4%B8%8D%E8%83%BD%E5%81%9C+2');
  assert.equal(webSearchUrl('google', ''), 'https://www.google.com/');
  assert.throws(() => webSearchUrl('other' as 'google', 'x'));
});
test('import preview distinguishes new, duplicate, conflict and invalid', () => {
  const values = [site, { ...site, name: '新名字' }, { ...site, id: 'new', url: 'https://other.example/' }, { ...site, id: 'bad', url: 'file:///x' }];
  const preview = previewImport(JSON.stringify({ version: 1, sites: values }), [site]);
  assert.deepEqual(preview.map(x => x.status), ['duplicate', 'duplicate', 'new', 'invalid']);
  assert.equal(applyImport([site], preview, []).length, 2);
  const conflict = previewImport(JSON.stringify({ version: 1, sites: [{ ...site, name: '新名字' }] }), [site]);
  assert.equal(conflict[0].status, 'conflict');
  assert.equal(applyImport([site], conflict, [0])[0].name, '新名字');
});
test('SOTVLA pages use api and vod identity and preserve line episode order', () => {
  const item = (id: number) => ({ _api_id: '1', vod_id: String(id), vod_name: `影片${id}`, vod_pic: '', vod_year: '2026', vod_serial: '更新中', _api_name: 'QQ' });
  const body = `<script>window.SOTV_SEARCH_PROGRESS = ${JSON.stringify({ items: [item(10), item(11), item(12)], perPage: 2 })};</script>`;
  const first = parseSotvlaSearch(body, site.url, site, 1), second = parseSotvlaSearch(body, site.url, site, 2);
  assert.deepEqual(first.items.map(x => x.id), ['1:10', '1:11']); assert.equal(first.hasMore, true);
  assert.deepEqual(second.items.map(x => x.id), ['1:12']); assert.equal(second.hasMore, false);
  const detail = `<button class="play-source-tab" data-src="0">线路甲</button><button class="play-source-tab" data-src="1">线路乙</button><div data-src-panel="0"><a class="play-ep-pill" href="/play.php?api_id=1&vod_id=10&src=0&ep=0">第1集</a><a class="play-ep-pill" href="/play.php?api_id=1&vod_id=10&src=0&ep=1">第2集</a></div><div data-src-panel="1"><a class="play-ep-pill" href="/play.php?api_id=1&vod_id=10&src=1&ep=0">国语</a></div>`;
  const parsed = parseSotvlaDetail(detail, site.url, first.items[0]);
  assert.deepEqual(parsed.lines.map(x => x.episodes.length), [2, 1]); assert.equal(parsed.lines[0].episodes[1].name, '第2集');
});
test('search removes unrelated titles and resolves relative covers', () => {
  const body = `<script>window.SOTV_SEARCH_PROGRESS = ${JSON.stringify({ items: [
    { _api_id: '11', vod_id: '1', vod_name: '年会不能停2！', vod_pic: '/poster.webp' },
    { _api_id: '11', vod_id: '2', vod_name: '我们不能在一起', vod_pic: 'javascript:bad' }
  ], perPage: 16 })};</script>`;
  const parsed = relevantResults(parseSotvlaSearch(body, site.url, site), '年会不能停2');
  assert.deepEqual(parsed.items.map(x => x.id), ['11:1']);
  assert.equal(parsed.items[0].cover, 'https://www.sotvla3.cc/poster.webp');
});
test('Dami detail keeps separate playback routes', () => {
  const result: SearchResult = { id: '1', siteId: 'dmxq', title: '影片', url: 'https://dmxq0.com/voddetail/1.html', cover: '', year: '', update: '', source: '' };
  const body = `<div class="module-tab-item">线路甲</div><div class="module-tab-item">线路乙</div><div class="module-play-list"><a href="/vodplay/1-1-1.html">一</a><a href="/vodplay/1-1-2.html">二</a></div><div class="module-play-list"><a href="/vodplay/1-2-1.html">一</a></div>`;
  const parsed = parseDmxqDetail(body, result.url, result); assert.deepEqual(parsed.lines.map(x => x.episodes.length), [2, 1]);
  assert.equal(parsed.lines[1].episodes[0].url, 'https://dmxq0.com/vodplay/1-2-1.html');
});
test('Dushe search pagination and per-line episode order match observed DOM', () => {
  const dushe: Site = { id: 'dushe', name: '毒舌', url: 'https://dushe3.app/', adapter: 'dushe', enabled: true };
  const search = `<a class="search-result-item" href="/detail/195930.html"><img src="/cover.jpg"><div class="title">仙逆</div><div class="tags"><span>2023</span></div></a><a class="page-item-next" href="/search?k=x&page=2&t=token">下一页</a>`;
  const page = parseDusheSearch(search, 'https://www.dushe1.app/search', dushe, 1);
  assert.deepEqual(page.items.map(x => x.id), ['195930']); assert.equal(page.hasMore, true);
  assert.equal(page.items[0].cover, 'https://www.dushe1.app/cover.jpg');
  const html = `<div class="detail-play-box"><a class="source-item"><span class="source-item-label">极速</span></a><a class="source-item"><span class="source-item-label">高清</span></a><div class="episode-list"><a class="episode-item" href="/play/195930-1-1.html">第1集</a><a class="episode-item" href="/play/195930-1-2.html">第2集</a></div><div class="episode-list" style="display:none"><a class="episode-item" href="/play/195930-2-1.html">第1集</a></div></div>`;
  const detail = parseDusheDetail(html, 'https://www.dushe1.app/detail/195930.html', page.items[0]);
  assert.deepEqual(detail.lines.map(x => [x.name, x.episodes.length]), [['极速', 2], ['高清', 1]]);
  assert.equal(detail.lines[1].episodes[0].url, 'https://www.dushe1.app/play/195930-2-1.html');
});
test('template categories parse observed search cards and keep playback routes separate', () => {
  const cases: { adapter: Site['adapter']; url: string; search: string; detail: string; expected: string }[] = [
    { adapter: 'myui', url: 'https://www.lvsc168.com/', search: '<li class="clearfix"><a class="myui-vodlist__thumb" href="/movie/93482.html" title="绿灯军团" data-original="/cover.jpg"></a></li>', detail: '<ul class="myui-content__list"><li><a href="/play/93482-0-0.html">第01集</a></li><li><a href="/play/93482-0-1.html">第02集</a></li><li><a href="/play/93482-1-0.html">第01集</a></li></ul>', expected: '/play/93482-0-0.html' },
  ];
  for (const c of cases) {
    const configured: Site = { id: c.adapter, name: c.adapter, url: c.url, adapter: c.adapter, enabled: true };
    const page = parseTemplateSearch(c.search, c.url, configured); assert.equal(page.items.length, 1);
    const detail = parseTemplateDetail(c.detail, c.url, page.items[0], c.adapter); assert.equal(detail.lines[0].episodes[0].url, c.url.slice(0, -1) + c.expected);
    if (c.adapter === 'myui') assert.deepEqual(detail.lines.map(line => line.episodes.length), [2, 1]);
  }
});
test('template pagination ignores a next link beyond the declared last page', () => {
  const configured: Site = { id: 'lvsc', name: '绿色影视', url: 'https://www.lvsc168.com/', adapter: 'myui', enabled: true };
  const card = '<li class="clearfix"><a href="/movie/92011.html" title="绿灯军团"></a></li>';
  const falseNext = '<a href="/search.php?page=2&searchword=x">下一页</a><a href="/search.php?page=1&searchword=x">尾页</a>';
  const realNext = '<a href="/search.php?page=2&searchword=x">下一页</a><a href="/search.php?page=3&searchword=x">尾页</a>';
  assert.equal(parseTemplateSearch(card + falseNext, configured.url, configured).hasMore, false);
  assert.equal(parseTemplateSearch(card + realNext, configured.url, configured).hasMore, true);
});
