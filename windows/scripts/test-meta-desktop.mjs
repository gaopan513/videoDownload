import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
const userData = await mkdtemp(path.resolve('.test-data/meta-desktop-'));
const checks = [];
const env = { ...process.env, STREAMHARBOR_TEST_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  const executablePath = process.argv[2];
  app = await electron.launch({ ...(executablePath ? { executablePath: path.resolve(executablePath), args: [] } : { args: ['.'] }), env });
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '下载工作台' }).waitFor();
  await app.evaluate(async ({ session }) => {
    for (const platform of ['instagram', 'facebook']) {
      const ses = session.fromPartition(`persist:meta-${platform}`);
      await ses.protocol.handle('https', req => {
        const url = new URL(req.url);
        const json = (value, xssi = false) => new Response((xssi ? 'for (;;);' : '') + JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
        const html = body => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
        if (url.hostname === 'fb.watch') return Response.redirect('https://www.facebook.com/reel/12345/');
        if (url.pathname === '/data') return json({ id: '12345', videoDeliveryResponseFragment: { progressive_urls: [{ progressive_url: 'https://video.fbcdn.net/full.mp4?sig=keep&bytestart=0&byteend=1', metadata: { quality: 'HD' } }] } }, true);
        if (url.pathname === '/old-data') return new Promise(resolve => setTimeout(() => resolve(json({ title: 'old page video', playable_url: 'https://video.fbcdn.net/wrong-old.mp4' })), 900));
        if (url.pathname === '/new-data') return new Promise(resolve => setTimeout(() => resolve(json({ title: 'new page video', playable_url: 'https://video.fbcdn.net/correct-new.mp4' })), 100));
        if (url.pathname.includes('switch')) return html('<title>SPA switch</title><script>fetch("/old-data"); setTimeout(()=>{history.pushState({},"","/reel/67890/");fetch("/new-data")},200)</script>');
        if (url.pathname.includes('cancel')) return html('<title>等待</title>');
        if (url.pathname.includes('dash')) return html('<script type="application/json">{"video_dash_manifest":"<MPD/>"}</script>');
        if (url.pathname.includes('login-needed')) return Response.redirect('https://www.instagram.com/accounts/login/');
        if (url.pathname.includes('login')) return html('<title>登录</title>');
        if (url.hostname.includes('fbcdn.net')) return new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'video/mp4' } });
        if (platform === 'instagram') return html('<title>Instagram fixture</title><script type="application/json">{"code":"DesktopTest","caption":{"text":"目标视频"},"video_versions":[{"url":"https://video.fbcdn.net/high.mp4","height":720},{"url":"https://video.fbcdn.net/low.mp4","height":480}]}</script><script>fetch("https://video.fbcdn.net/decoy.mp4")</script>');
        return html('<title>Facebook fixture</title><script>fetch("/data").then(r=>r.json()).then(()=>{}); fetch("https://video.fbcdn.net/decoy.mp4")</script>');
      });
    }
    await session.fromPartition('persist:meta-instagram').cookies.set({ url: 'https://www.instagram.com/', name: 'sessionid', value: 'fixture', secure: true });
  });
  await page.locator('#urls').fill('https://www.instagram.com/reel/DesktopTest/');
  await page.getByRole('button', { name: '解析链接' }).click();
  await page.getByRole('heading', { name: '发现 2 个资源' }).waitFor({ timeout: 15000 });
  assert.equal(await page.getByText('Instagram 720p', { exact: true }).count(), 1);
  assert.equal(await page.getByText('目标视频', { exact: true }).count(), 2);
  checks.push('Instagram embedded JSON, quality selection and raw MP4 exclusion through real UI/IPC');
  const fb = await page.evaluate(() => window.harbor.resolve('https://fb.watch/desktop/'));
  assert.equal(fb.length, 1); assert.equal(fb[0].quality, 'Facebook HD');
  assert.equal(fb[0].url, undefined); assert.equal(fb[0].context, undefined);
  checks.push('Facebook short-link redirect and dynamic XSSI JSON via Chromium debugger; public IPC hides credentials');
  const switched = await page.evaluate(() => window.harbor.resolve('https://www.facebook.com/reel/switch/12345/'));
  assert.equal(switched.length, 1);
  // The two payloads deliberately lack IDs: attribution must come from request lifecycle.
  assert.equal(switched[0].quality, 'Facebook SD');
  assert.equal(switched[0].title, 'new page video');
  checks.push('delayed old-page JSON is discarded after SPA navigation');
  await page.locator('#urls').fill('https://www.instagram.com/reel/DesktopTest/');
  const visitPage = app.waitForEvent('window');
  await page.getByRole('button', { name: '访问平台' }).click();
  await (await visitPage).waitForURL(/instagram\.com/);
  await app.evaluate(async ({ BrowserWindow }) => {
    const visit = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('instagram.com'));
    if (!visit) throw new Error('visit window missing');
    if (visit.webContents.getLastWebPreferences().preload) throw new Error('unexpected preload');
    if (!(await visit.webContents.session.cookies.get({ name: 'sessionid' })).some(c => c.value === 'fixture')) throw new Error('session not shared');
    visit.destroy();
  });
  checks.push('platform visit shares persistent login session without app preload');
  await assert.rejects(page.evaluate(() => window.harbor.resolve('https://www.instagram.com/reel/login-needed/')), /登录或验证/);
  checks.push('login redirect reports actionable access error');
  const pending = page.evaluate(() => window.harbor.resolve('https://www.instagram.com/reel/cancel/')).then(() => false, () => true);
  await new Promise(r => setTimeout(r, 600)); await page.evaluate(() => window.harbor.cancelResolve()); assert.ok(await pending);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => !w.isVisible()).length), 0);
  checks.push('cancel closes hidden resolver window and clears busy state');
  await assert.rejects(page.evaluate(() => window.harbor.resolve('https://www.instagram.com/reel/dash/')), /DASH 分离/);
  checks.push('DASH-only gets explicit error without promoting a raw track to MP4');
  await assert.rejects(page.evaluate(() => window.harbor.visitMeta('https://evil.test/')), /Instagram 或 Facebook/);
  checks.push('platform visit rejects arbitrary remote pages');
  await mkdir('artifacts', { recursive: true });
  const name = executablePath ? 'meta-desktop-packaged' : 'meta-desktop';
  await page.screenshot({ path: `artifacts/${name}.png` });
  await writeFile(`artifacts/${name}-validation.json`, JSON.stringify({ timestamp: new Date().toISOString(), packaged: !!executablePath, checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  if (app) await app.close();
  // Only this script's newly created, isolated profile is removed.
  if (userData.startsWith(path.resolve('.test-data') + path.sep)) await rm(userData, { recursive: true, force: true });
}
