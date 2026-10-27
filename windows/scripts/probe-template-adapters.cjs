const { app, session } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { searchSite, getDetail, discover } = require('../dist/tests/site-runtime.cjs');
const temp = mkdtempSync(path.join(os.tmpdir(), 'streamharbor-template-probe-'));
app.setPath('userData', temp);
app.commandLine.appendSwitch('disable-gpu');
const sites = [
  { id: 'lvsc', name: '绿色影视', url: 'https://www.lvsc168.com/', adapter: 'myui', enabled: true },
  { id: 'didahd', name: '嘀嗒影视', url: 'https://www.didahd.xyz/', adapter: 'myui', enabled: true }
];
const query = process.argv.find(arg => arg.startsWith('--query='))?.slice(8) || '绿灯军团';
const media = process.argv.includes('--media');
const siteFilter = process.argv.find(arg => arg.startsWith('--site='))?.slice(7);
app.whenReady().then(async () => {
  const report = {};
  for (const site of sites) {
    if (siteFilter && site.id !== siteFilter) continue;
    const ses = session.fromPartition('persist:probe-' + site.id);
    const row = { adapter: site.adapter, query };
    try {
      const page = await searchSite(site, ses, query, 1, AbortSignal.timeout(45000));
      row.search = { count: page.items.length, hasMore: page.hasMore, first: page.items[0] };
      if (page.hasMore) {
        try { const second = await searchSite(site, ses, query, 2, AbortSignal.timeout(45000)); row.page2 = { count: second.items.length, firstId: second.items[0]?.id, distinct: second.items[0]?.id !== page.items[0]?.id }; }
        catch (e) { row.page2Error = String(e.message || e); }
      }
      const chosen = process.argv.includes('--alternate') && page.items[1] ? page.items[1] : page.items[0];
      if (chosen) {
        row.chosen = { id: chosen.id, title: chosen.title };
        const detail = await getDetail(site, ses, chosen, AbortSignal.timeout(35000));
        row.detail = { lines: detail.lines.map(line => ({ id: line.id, name: line.name, count: line.episodes.length })), firstPlayUrl: detail.lines[0]?.episodes[0]?.url };
        if (media && row.detail.firstPlayUrl) {
          try { const found = await discover(row.detail.firstPlayUrl, '', AbortSignal.timeout(60000), ses); row.media = found.map(item => ({ kind: item.kind, quality: item.quality, host: new URL(item.url).hostname })); }
          catch (e) { row.mediaError = String(e.message || e); }
        }
      }
    } catch (e) { row.error = String(e.message || e); }
    report[site.id] = row;
    console.log(JSON.stringify({ site: site.id, count: row.search?.count, lines: row.detail?.lines?.length, error: row.error }));
  }
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/template-adapters-probe.json', JSON.stringify(report, null, 2));
  app.quit();
}).catch(e => { console.error(e); app.quit(); });
app.on('window-all-closed', () => {});
app.on('quit', () => { if (path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) rmSync(temp, { recursive: true, force: true }); });
