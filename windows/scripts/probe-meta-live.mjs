import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const userData = await mkdtemp(path.resolve('.test-data/meta-live-'));
const output = path.join(userData, 'downloads'); await mkdir(output);
const env = { ...process.env, STREAMHARBOR_TEST_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
const run = promisify(execFile), rows = [];
let app;
try {
  app = await electron.launch({ args: ['.'], env }); const page = await app.firstWindow();
  await page.getByRole('heading', { name: '下载工作台' }).waitFor();
  const settings = (await page.evaluate(() => window.harbor.init())).settings;
  await page.evaluate(s => window.harbor.saveSettings(s), { ...settings, directory: output, deep: true });
  for (const url of ['https://www.instagram.com/reel/Chunk8-jurw/', 'https://www.facebook.com/100064305355374/videos/1040750538995454/', 'https://www.facebook.com/watch/?v=10154122520715466']) {
    const row = { url, resolved: false, downloaded: false }; const start = Date.now();
    try {
      const candidates = await page.evaluate(url => window.harbor.resolve(url), url);
      row.resolved = true; row.candidates = candidates.map(c => ({ title: c.title, kind: c.kind, quality: c.quality }));
      console.log(JSON.stringify({ url, resolved: true, count: candidates.length }));
      const before = new Set((await page.evaluate(() => window.harbor.init())).tasks.map(t => t.id));
      await page.evaluate(({ id, output }) => window.harbor.add(id, output), { id: candidates[0].id, output });
      let task; const deadline = Date.now() + 180000;
      do {
        task = (await page.evaluate(() => window.harbor.init())).tasks.find(t => !before.has(t.id));
        if (task && ['complete', 'failed', 'confirm'].includes(task.state)) break;
        await new Promise(r => setTimeout(r, 500));
      } while (Date.now() < deadline);
      if (!task) throw new Error('download task missing');
      if (task.state !== 'complete') throw new Error(task.message || task.state);
      row.downloaded = true; row.bytes = (await stat(task.output)).size;
      const probe = JSON.parse((await run(path.resolve('node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', task.output])).stdout);
      row.duration = Number(probe.format.duration); row.streams = probe.streams.map(s => ({ type: s.codec_type, codec: s.codec_name, width: s.width, height: s.height })); row.deepDecode = true;
      await page.evaluate(id => window.harbor.deleteRecord(id), task.id);
    } catch (e) { row.error = String(e.message || e); }
    row.seconds = (Date.now() - start) / 1000; rows.push(row); console.log(JSON.stringify(row));
    await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/meta-live-validation.json', JSON.stringify({ timestamp: new Date().toISOString(), rows }, null, 2));
  }
} finally {
  if (app) await app.close();
  if (userData.startsWith(path.resolve('.test-data') + path.sep)) await rm(userData, { recursive: true, force: true });
}
