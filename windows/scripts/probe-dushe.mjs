import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'streamharbor-dushe-'));
const env = { ...process.env, STREAMHARBOR_TEST_DATA: dataDir }; delete env.ELECTRON_RUN_AS_NODE;
let app; const result = {};
try {
  app = await electron.launch({ args: ['.'], env }); const main = await app.firstWindow();
  try { await main.evaluate(() => window.harbor.visitSite('dushe')); } catch (e) { result.visitError = String(e.message || e); }
  await new Promise(r => setTimeout(r, 2500)); const windows = app.windows();
  for (const page of windows.slice(1)) {
    result.url = page.url(); result.title = await page.title().catch(() => '');
    result.dom = await page.evaluate(() => ({ text: document.body?.innerText.slice(0, 700), forms: [...document.forms].map(f => ({ action: f.action, method: f.method, fields: [...f.querySelectorAll('input')].map(i => ({ name: i.name, type: i.type })) })), links: [...document.querySelectorAll('a[href]')].slice(0, 40).map(a => ({ text: a.textContent?.trim().slice(0, 30), href: a.href })) })).catch(e => ({ error: String(e) }));
    const form = page.locator('form[action*="/search"]').first();
    if (await form.count()) {
      await form.locator('input[name="k"]').fill('仙逆');
      await form.locator('input[name="k"]').press('Enter');
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      result.search = await page.evaluate(() => ({ url: location.href, title: document.title, text: document.body?.innerText.slice(0, 500), links: [...document.querySelectorAll('a[href*="/detail"],a[href*="/voddetail"],a[href*="/video/"]')].slice(0, 12).map(a => ({ text: a.textContent?.trim().slice(0, 30), href: a.href, className: a.className })) }));
    }
  }
  await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/dushe-probe.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await app?.close().catch(() => {}); if (dataDir.startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(dataDir, { recursive: true, force: true }); }
