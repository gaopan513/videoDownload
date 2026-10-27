import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'streamharbor-site-'));
const env = { ...process.env, STREAMHARBOR_TEST_DATA: dataDir }; delete env.ELECTRON_RUN_AS_NODE;
const siteFilter = process.argv.find(arg => arg.startsWith('--site='))?.slice('--site='.length);
const apiFilter = process.argv.find(arg => arg.startsWith('--api='))?.slice('--api='.length);
const query = process.argv.find(arg => arg.startsWith('--query='))?.slice('--query='.length) || '仙逆';
const results = {}; let app;
try {
  app = await electron.launch({ args: ['.'], env }); const page = await app.firstWindow();
  await page.getByRole('heading', { name: '下载工作台' }).waitFor({ timeout: 20000 });
  const sites = await page.evaluate(() => window.harbor.sites());
  const events = await page.evaluate(async ({ ids, query }) => {
    const received = [];
    const id = crypto.randomUUID();
    const off = window.harbor.onSearch(value => { if (value.requestId === id) received.push(value); });
    await window.harbor.search(query, ids, 1, undefined, id);
    const started = Date.now(); while (received.length < ids.length && Date.now() - started < 42000) await new Promise(r => setTimeout(r, 200));
    off(); return received;
  }, { ids: sites.filter(s => s.enabled && s.adapter !== 'none' && (!siteFilter || s.id === siteFilter)).map(s => s.id), query });
  if (process.argv.includes('--full-download')) await page.evaluate(async () => { const state = await window.harbor.init(); await window.harbor.saveSettings({ ...state.settings, deep: true }); });
  for (const site of sites) {
    if (siteFilter && site.id !== siteFilter) continue;
    const event = events.find(e => e.siteId === site.id);
    const chosen = apiFilter && site.id === 'sotvla' ? event?.result?.items.find(x => x.id.startsWith(apiFilter + ':')) : process.argv.includes('--alternate') && site.id === 'sotvla' ? event?.result?.items.find(x => !x.id.startsWith('1:')) : event?.result?.items[0];
    const record = { site: site.name, adapter: site.adapter, query, search: event?.error || (event?.result ? `${event.result.items.length} items` : 'no response'), firstTitle: chosen?.title, firstDetailUrl: chosen?.url, sample: event?.result?.items.slice(0, 5).map(x => ({ title: x.title, id: x.id, cover: x.cover })) };
    if (process.argv.includes('--cover-probe') && event?.result?.items.length) {
      record.covers = await page.evaluate(async items => Promise.all(items.map(async item => { try { const data = await window.harbor.cover(item.siteId, item.cover); return { id: item.id, bytes: Math.floor(data.length * 3 / 4) }; } catch (e) { return { id: item.id, error: String(e.message || e) }; } })), event.result.items.slice(0, 3));
    }
    if (event?.result?.items.length) {
      const next = await page.evaluate(async ({ id, query }) => { const requestId = crypto.randomUUID(); return new Promise(async (resolve, reject) => { const timer = setTimeout(() => { off(); reject(new Error('page 2 timeout')); }, 35000); const off = window.harbor.onSearch(value => { if (value.requestId !== requestId) return; clearTimeout(timer); off(); resolve(value); }); try { await window.harbor.search(query, [id], 2, id, requestId); } catch (e) { clearTimeout(timer); off(); reject(e); } }); }, { id: site.id, query }).catch(e => ({ error: String(e) }));
      record.page2 = next.error || (next.result ? { count: next.result.items.length, firstId: next.result.items[0]?.id, distinct: next.result.items[0]?.id !== event.result.items[0]?.id } : 'no response');
      try {
        const detail = await page.evaluate(item => window.harbor.detail(item), chosen);
        record.detail = `${detail.lines.length} lines; ${detail.lines.map(l => l.episodes.length).join(',')} episodes`;
        record.firstPlayUrl = detail.lines[0]?.episodes[0]?.url;
        if (process.argv.includes('--direct-resolve') && record.firstPlayUrl) {
          try { record.directResolve = await page.evaluate(url => window.harbor.resolve(url).then(items => items.map(x => ({ kind: x.kind, title: x.title }))), record.firstPlayUrl); }
          catch (e) { record.directResolve = String(e.message || e); }
        }
        if (process.argv.includes('--direct-download') && record.firstPlayUrl) {
          const directOutput = path.join(dataDir, 'direct-download'); await mkdir(directOutput, { recursive: true });
          try { record.directDownload = await page.evaluate(async ({ url, directory }) => {
            const existing = new Set((await window.harbor.init()).tasks.map(t => t.id));
            const candidates = await window.harbor.resolve(url); if (!candidates.length) throw new Error('No candidates');
            await window.harbor.add(candidates[0].id, directory);
            const started = Date.now(); let task;
            while (Date.now() - started < 65000) { task = (await window.harbor.init()).tasks.find(t => !existing.has(t.id)); if (task && (task.done > 0 || ['failed', 'complete', 'choice'].includes(task.state))) break; await new Promise(r => setTimeout(r, 1000)); }
            if (task && !['failed', 'complete'].includes(task.state)) await window.harbor.control(task.id, 'pause');
            return task && { state: task.state, kind: task.kind, done: task.done, total: task.total, message: task.message };
          }, { url: record.firstPlayUrl, directory: directOutput }); }
          catch (e) { record.directDownload = String(e.message || e); }
        }
        if ((process.argv.includes('--media-probe') || process.argv.includes('--full-download')) && detail.lines[0]?.episodes[0]) {
          const output = path.join(dataDir, 'downloads'); await mkdir(output, { recursive: true });
          await page.evaluate(([d, directory, id]) => window.harbor.batch(d, d.lines[0].id, [d.lines[0].episodes[0].id], directory, id), [detail, output, `probe-${site.id}`]);
          const full = process.argv.includes('--full-download');
          const segmentProbe = process.argv.includes('--segment-probe');
          const outcome = await page.evaluate(async ({ title, full, segmentProbe }) => { const started = Date.now(); let last; while (Date.now() - started < (full ? 240000 : 65000)) { const data = await window.harbor.init(); last = data.tasks.find(t => t.title === title); if (last?.state === 'choice' && full && last.choices?.length) { await window.harbor.chooseCandidate(last.id, last.choices[0].id); continue; } if (last && (full ? ['failed', 'complete'].includes(last.state) : segmentProbe ? ['failed', 'complete', 'choice'].includes(last.state) || last.done > 0 : ['downloading', 'choice', 'failed', 'complete'].includes(last.state))) break; await new Promise(r => setTimeout(r, 1000)); } if (last && !['failed', 'complete'].includes(last.state)) await window.harbor.control(last.id, 'pause'); return last && { state: last.state, kind: last.kind, message: last.message, done: last.done, total: last.total, output: last.output }; }, { title: `${detail.title} · ${detail.lines[0].episodes[0].name}`, full, segmentProbe });
          record.media = outcome;
          if (outcome?.output) { record.outputBytes = (await stat(outcome.output)).size; record.outputSha256 = await new Promise((resolve, reject) => { const hash = createHash('sha256'); const stream = createReadStream(outcome.output); stream.on('data', chunk => hash.update(chunk)); stream.on('error', reject); stream.on('end', () => resolve(hash.digest('hex'))); }); }
        }
      } catch (e) { record.detail = String(e.message || e); }
    }
    results[site.id] = record;
  }
  await mkdir('artifacts', { recursive: true });
  const report = `artifacts/site-acceptance${siteFilter ? '-' + siteFilter : ''}${apiFilter ? '-api' + apiFilter : process.argv.includes('--alternate') ? '-alternate' : ''}${process.argv.includes('--segment-probe') ? '-segment' : process.argv.includes('--direct-download') ? '-direct' : ''}.json`;
  await writeFile(report, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await app?.close().catch(() => {}); if (dataDir.startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(dataDir, { recursive: true, force: true }); }
