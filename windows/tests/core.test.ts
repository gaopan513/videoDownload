import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID, createCipheriv } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { download, safeName, tempDirectory } from '../src/core/engine';
import { segments, decrypt } from '../src/core/hls';
import { Network, requestHeaders } from '../src/core/net';
import { probe, run } from '../src/core/media';
import type { Job, Context } from '../src/shared';

const root = path.resolve('.test-data/core-' + randomUUID());
const ffmpeg = path.resolve('node_modules/ffmpeg-static/ffmpeg.exe');
const ffprobe = path.resolve('node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
const files = new Map<string, Buffer>(); const hits = new Map<string, number>();
let origin = ''; let plain: Buffer; let videoFrames: string;
const server = createServer((req, res) => {
  const url = new URL(req.url!, 'http://localhost'); const p = url.pathname; hits.set(p, (hits.get(p) || 0) + 1);
  if (p === '/missing-key') { res.writeHead(403); res.end(); return; }
  if (p === '/flaky.ts' && hits.get(p) === 1) { res.writeHead(503); res.end(); return; }
  const data = files.get(p); if (!data) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', p.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : p.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream');
  res.setHeader('ETag', p === '/changed.mp4' ? '"different"' : '"fixture-v1"');
  const range = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
  if (range && p === '/bad-range.mp4' && +range[2] > 0) { res.writeHead(206, { 'Content-Range': 'bytes 0-1/2' }); res.end(data); return; }
  if (range && p !== '/no-range.mp4') { const start = +range[1], end = Math.min(+range[2], data.length - 1); res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 }); res.end(data.subarray(start, end + 1)); }
  else { res.setHeader('Content-Length', data.length); res.end(data); }
});
const signal = () => AbortSignal.timeout(60000);
before(async () => {
  await mkdir(root, { recursive: true });
  const sample = path.join(root, 'source.mp4');
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=800:sample_rate=44100', '-t', '4', '-c:v', 'libx264', '-g', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sample], signal());
  videoFrames = await run(ffmpeg, ['-v', 'error', '-i', sample, '-map', '0:v:0', '-f', 'framemd5', '-'], signal());
  plain = await readFile(sample); files.set('/video.mp4', plain); files.set('/no-range.mp4', plain); files.set('/changed.mp4', plain);
  files.set('/bad-range.mp4', plain);
  files.set('/large.mp4', Buffer.concat([plain, Buffer.alloc(10 * 1024 * 1024)]));
  await run(ffmpeg, ['-v', 'error', '-y', '-i', sample, '-c', 'copy', '-hls_time', '1', '-hls_list_size', '0', '-hls_segment_filename', path.join(root, 'seg%d.ts'), path.join(root, 'video.m3u8')], signal());
  await run(ffmpeg, ['-v', 'error', '-y', '-i', sample, '-an', '-c:v', 'copy', '-hls_time', '1', '-hls_list_size', '0', '-hls_segment_type', 'fmp4', '-hls_segment_filename', path.join(root, 'fmp%d.m4s'), path.join(root, 'fmp.m3u8')], signal(), root);
  await run(ffmpeg, ['-v', 'error', '-y', '-i', sample, '-vn', '-c:a', 'copy', '-hls_time', '1', '-hls_list_size', '0', '-hls_segment_filename', path.join(root, 'audio%d.ts'), path.join(root, 'audio.m3u8')], signal());
  for (const name of await readdir(root)) files.set('/' + name, await readFile(path.join(root, name)));
  const playlist = (await readFile(path.join(root, 'video.m3u8'), 'utf8'));
  files.set('/retry.m3u8', Buffer.from(playlist.replace('seg0.ts', 'flaky.ts'))); files.set('/flaky.ts', files.get('/seg0.ts')!);
  const segNames = [...playlist.matchAll(/seg\d+\.ts/g)].map(m => m[0]); const encLines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:1', '#EXT-X-MEDIA-SEQUENCE:10'];
  segNames.forEach((name, i) => { const key = Buffer.alloc(16, i + 1); const iv = Buffer.alloc(16); iv.writeUInt32BE(i + 10, 12); const cipher = createCipheriv('aes-128-cbc', key, iv); files.set(`/key${i}`, key); files.set(`/enc${i}.ts`, Buffer.concat([cipher.update(files.get('/' + name)!), cipher.final()])); encLines.push(`#EXT-X-KEY:METHOD=AES-128,URI="key${i}"${i % 2 ? ',IV=0x' + iv.toString('hex') : ''}`, '#EXTINF:1,', `enc${i}.ts`); });
  encLines.push('#EXT-X-ENDLIST'); files.set('/encrypted.m3u8', Buffer.from(encLines.join('\n'))); files.set('/badkey.m3u8', Buffer.from(encLines.join('\n').replace('key0', 'missing-key')));
  files.set('/live.m3u8', Buffer.from(playlist.replace('#EXT-X-ENDLIST', '')));
  const joined = Buffer.concat(segNames.map(n => files.get('/' + n)!)); files.set('/joined.ts', joined); let offset = 0; const rangeLines = ['#EXTM3U', '#EXT-X-VERSION:4', '#EXT-X-TARGETDURATION:1'];
  segNames.forEach(n => { const len = files.get('/' + n)!.length; rangeLines.push('#EXTINF:1,', `#EXT-X-BYTERANGE:${len}@${offset}`, 'joined.ts'); offset += len; }); rangeLines.push('#EXT-X-ENDLIST'); files.set('/range.m3u8', Buffer.from(rangeLines.join('\n')));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
function job(url: string, kind: 'mp4' | 'hls' = 'mp4'): Job { const source = origin + url; return { id: randomUUID(), directory: root, concurrency: 3, proxy: '', mode: 'mp4', deep: true, ffmpeg, ffprobe, ytdlp: '', candidate: { id: randomUUID(), title: 'fixture', url: source, source, kind, context: { origin: source, headers: {}, cookies: [] } } }; }
async function verify(out: string) { const p = await probe(ffprobe, out, signal()); assert.ok(Number(p.format.duration) >= 3.9); const frames = await run(ffmpeg, ['-v', 'error', '-i', out, '-map', '0:v:0', '-f', 'framemd5', '-'], signal()); const md5s = (s: string) => s.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split(',').at(-1)?.trim()); assert.deepEqual(md5s(frames), md5s(videoFrames)); }
test('MP4 Range and no-Range download preserve decoded video', async () => { await verify(await download(job('/video.mp4'), signal(), () => {})); await verify(await download(job('/no-range.mp4'), signal(), () => {})); });
test('pause and resume validate saved chunks without mixing resources', async () => { const j = job('/large.mp4'); const c = new AbortController(); await assert.rejects(download(j, c.signal, e => { if (e.type === 'progress' && e.done >= 4194304) c.abort(); })); const saved = JSON.parse(await readFile(path.join(tempDirectory(j), 'mp4.json'), 'utf8')); assert.ok(Object.keys(saved.parts).length); await verify(await download(j, signal(), () => {})); });
test('HLS TS, retry and byte ranges preserve every video frame', async () => { for (const p of ['/video.m3u8', '/retry.m3u8', '/range.m3u8']) await verify(await download(job(p, 'hls'), signal(), () => {})); assert.ok(hits.get('/flaky.ts')! >= 2); });
test('AES-128 explicit/implicit IV and key rotation', async () => { await verify(await download(job('/encrypted.m3u8', 'hls'), signal(), () => {})); });
test('fMP4 initialization and independent audio', async () => { const j = job('/fmp.m3u8', 'hls'); j.candidate.audioUrl = origin + '/audio.m3u8'; const out = await download(j, signal(), () => {}); await verify(out); const p = await probe(ffprobe, out, signal()); const audio = p.streams.find((s: any) => s.codec_type === 'audio'); const video = p.streams.find((s: any) => s.codec_type === 'video'); assert.ok(audio); assert.ok(Math.abs(Number(audio.start_time) - Number(video.start_time)) < 0.15); });
test('missing keys and live playlists fail explicitly', async () => { await assert.rejects(download(job('/badkey.m3u8', 'hls'), signal(), () => {}), /授权|过期/); await assert.rejects(download(job('/live.m3u8', 'hls'), signal(), () => {}), /直播/); });
test('unsafe credentials never cross origins or cookie path boundaries', () => { const ctx: Context = { origin: 'https://example.com/page', headers: { authorization: 'secret' }, cookies: [{ name: 's', value: 'x', domain: 'example.com', path: '/foo', secure: true }] }; assert.equal(requestHeaders('https://other.com/foo', ctx).authorization, undefined); assert.equal(requestHeaders('https://example.com/foobar', ctx).cookie, undefined); assert.equal(requestHeaders('https://example.com/foo/a', ctx).cookie, 's=x'); });
test('unsupported encryption and unsafe filenames', () => { assert.throws(() => segments('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="x"\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST', 'https://example.com/p.m3u8'), /DRM/); assert.equal(safeName('CON'), '_CON'); assert.equal(safeName('../bad:name'), '.._bad_name'); assert.throws(() => decrypt(Buffer.alloc(16), Buffer.alloc(3), '00'), /密钥/); });
test('invalid Range responses never become successful output', async () => { await assert.rejects(download(job('/bad-range.mp4'), signal(), () => {}), /分段响应变化/); });
test('HLS pause, hash-checked resume and same-name output', async () => { const j = job('/video.m3u8', 'hls'); const c = new AbortController(); await assert.rejects(download(j, c.signal, e => { if (e.type === 'progress' && e.done > 0) c.abort(); })); await verify(await download(j, signal(), () => {})); const second = await download(job('/video.m3u8', 'hls'), signal(), () => {}); assert.match(path.basename(second), /\(\d+\)/); });
test('resource validator change preserves recovery data', async () => { const j = job('/large.mp4'); const c = new AbortController(); await assert.rejects(download(j, c.signal, e => { if (e.type === 'progress' && e.done >= 4194304) c.abort(); })); j.candidate.url = origin + '/changed.mp4'; await assert.rejects(download(j, signal(), () => {}), /资源已变化/); assert.ok(await readFile(path.join(tempDirectory(j), 'mp4.json'))); });
test('output directory errors are surfaced', async () => { const invalid = path.join(root, 'not-directory'); await writeFile(invalid, 'file'); const j = job('/video.mp4'); j.directory = invalid; await assert.rejects(download(j, signal(), () => {})); });
test('new key declarations keep separate epochs even with the same URI', () => { const list = segments('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:1,\na.ts\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:1,\nb.ts\n#EXT-X-ENDLIST', 'https://example.com/p.m3u8'); assert.notEqual(list[0].epoch, list[1].epoch); });
test('manual HTTP proxy transports requests', async () => { const j = job('/video.mp4'); const net = new Network(j.candidate.context, origin); try { const response = await net.bytes(origin + '/video.mp4', signal()); assert.deepEqual(response.data, plain); } finally { net.close(); } });
test('unencrypted initialization is not decrypted with later segment keys', () => { const list = segments('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-KEY:METHOD=AES-128,URI="key",IV=0x00000000000000000000000000000001\n#EXTINF:1,\na.m4s\n#EXT-X-ENDLIST', 'https://example.com/p.m3u8'); assert.ok(list[0].key); assert.equal(list[0].map?.key, undefined); });
