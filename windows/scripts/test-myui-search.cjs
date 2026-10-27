const { app, BrowserWindow, session } = require('electron');
const { createServer } = require('node:http');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { searchSite, getDetail } = require('../dist/tests/site-runtime.cjs');
const temp = mkdtempSync(path.join(os.tmpdir(), 'streamharbor-myui-test-'));
app.setPath('userData', temp);
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
let searchRequests = 0;
const form = '<form action="/search.php"><input name="searchword"></form>';
const challenge = '<style>' + 'body{color:#333}'.repeat(500) + '</style><script>window._cf_chl_opt = {cType:"managed"};</script>正在进行安全验证';
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url === '/auto') return res.end(req.headers.cookie?.includes('ready=1') ? form : challenge + '<script>setTimeout(()=>location.replace("/ready"),1600)</script>');
  if (req.url === '/ready') { res.setHeader('Set-Cookie', 'ready=1; Path=/; SameSite=Lax'); return res.end(form); }
  if (req.url === '/blocked') return res.end(challenge);
  if (req.url?.startsWith('/search.php')) {
    searchRequests++;
    if (!req.headers.cookie?.includes('ready=1')) { res.statusCode = 403; return res.end('login required'); }
    assert.equal(new URL(req.url, 'http://localhost').searchParams.get('searchword'), '绿灯军团');
    return res.end('<li class="clearfix"><a href="/movie/93482.html" title="绿灯军团"></a></li>');
  }
  if (req.url === '/movie/93482.html') return res.end('<ul class="myui-content__list"><li><a href="/play/93482-0-0.html">第01集</a></li></ul>');
  res.statusCode = 404; res.end();
});
app.whenReady().then(async () => {
  const checks = [];
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const ses = session.fromPartition('persist:myui-test');
    const site = { id: 'myui-test', name: 'Myui', url: base + '/auto', adapter: 'myui', enabled: true };
    const page = await searchSite(site, ses, '绿灯军团', 1, AbortSignal.timeout(15000));
    assert.deepEqual(page.items.map(item => item.id), ['93482']);
    assert.equal(page.hasMore, false);
    checks.push('automatic verification navigation completes before search and preserves cookies');
    const detail = await getDetail(site, ses, page.items[0], AbortSignal.timeout(5000));
    assert.equal(detail.lines[0].episodes[0].url, base + '/play/93482-0-0.html');
    checks.push('search result detail and episode use the verified session');
    await searchSite(site, ses, '绿灯军团', 1, AbortSignal.timeout(5000));
    checks.push('retry reuses the verified site session');
    const before = searchRequests;
    await assert.rejects(searchSite({ ...site, url: base + '/blocked' }, ses, '绿灯军团', 1, AbortSignal.timeout(15000)), e => e.code === 'ACCESS' && /访问站点/.test(e.message));
    assert.equal(searchRequests, before);
    checks.push('persistent verification returns ACCESS instead of STRUCTURE without dispatching a search');
    const controller = new AbortController();
    const cancelled = searchSite({ ...site, url: base + '/blocked' }, ses, '绿灯军团', 1, controller.signal);
    const timer = setTimeout(() => controller.abort(), 1500);
    try { await assert.rejects(cancelled, e => e.code === 'TIMEOUT'); } finally { clearTimeout(timer); }
    assert.equal(BrowserWindow.getAllWindows().length, 0);
    checks.push('cancellation stops verification polling and destroys hidden windows');
    mkdirSync('artifacts', { recursive: true });
    writeFileSync('artifacts/myui-search-tests.json', JSON.stringify({ checks, searchRequests }, null, 2));
    console.log(JSON.stringify({ checks, searchRequests }, null, 2));
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { server.close(); app.quit(); }
});
app.on('quit', () => {
  if (path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) rmSync(temp, { recursive: true, force: true });
  if (process.exitCode) process.exit(process.exitCode);
});
