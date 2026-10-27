import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { download } from '../src/core/engine';
import { buildYoutubeSelector } from '../src/core/youtube';
import { parseBilibiliResponse } from '../src/core/platforms/bilibili';
import { DownloadError } from '../src/core/net';

test('HLS relative segments use the final redirected playlist URL', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'streamharbor-hls-redirect-'));
  const ffmpeg = path.resolve('node_modules/ffmpeg-static/ffmpeg.exe');
  const ffprobe = path.resolve('node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
  const media = execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=12', '-t', '1', '-c:v', 'libx264', '-f', 'mpegts', 'pipe:1'], { windowsHide: true });
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.url!);
    if (req.url === '/variant.m3u8') { res.writeHead(302, { location: '/cdn/video.m3u8' }); res.end(); }
    else if (req.url === '/cdn/video.m3u8') res.end('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST');
    else if (req.url === '/cdn/segment.ts') res.end(media);
    else { res.writeHead(404); res.end(); }
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/variant.m3u8`;
    const output = await download({ id: randomUUID(), directory, ffmpeg, ffprobe, ytdlp: '', concurrency: 2, proxy: '', mode: 'mp4', deep: true, candidate: { id: randomUUID(), title: 'redirect', url, source: url, kind: 'hls', context: { origin: url, headers: {}, cookies: [] } } }, AbortSignal.timeout(30000), () => {});
    assert.equal(path.basename(output), 'redirect.mp4');
    assert.deepEqual(hits, ['/variant.m3u8', '/cdn/video.m3u8', '/cdn/segment.ts']);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('YouTube selected height wins over codec preference and cannot silently fall back', () => {
  const formats = [
    { format_id: 'avc1080', ext: 'mp4', protocol: 'https', height: 1080, vcodec: 'avc1.640028', acodec: 'none', url: 'https://example.invalid/1080.mp4' },
    { format_id: 'vp9-2160', ext: 'webm', protocol: 'https', height: 2160, vcodec: 'vp9', acodec: 'none', url: 'https://example.invalid/2160.webm' },
    { format_id: 'audio', ext: 'm4a', protocol: 'https', vcodec: 'none', acodec: 'mp4a.40.2', abr: 128, url: 'https://example.invalid/audio.m4a' }
  ];
  const select = (height?: number) => spawnSync(path.resolve('build/yt-dlp.exe'), ['--ignore-config', '--no-cache-dir', '--load-info-json', '-', '--skip-download', '--no-check-formats', '-f', buildYoutubeSelector(height), '--print', '%(format_id)s'], { input: JSON.stringify({ id: 'AAAAAAAAAAA', title: 'fixture', extractor: 'youtube', extractor_key: 'Youtube', webpage_url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', formats }), encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const high = select(2160);
  assert.ifError(high.error);
  assert.equal(high.status, 0, high.stderr);
  assert.equal(high.stdout.trim(), 'vp9-2160+audio');
  const unavailable = select(1440);
  assert.ifError(unavailable.error);
  assert.notEqual(unavailable.status, 0);
  const automatic = select();
  assert.ifError(automatic.error);
  assert.equal(automatic.status, 0, automatic.stderr);
  assert.equal(automatic.stdout.trim(), 'avc1080+audio');
});

test('Bilibili multi-part durl fails explicitly instead of producing a truncated candidate', () => {
  const view = { code: 0, data: { title: 'fixture' } };
  const source = 'https://www.bilibili.com/video/BV1xx411c7mD';
  const parts = [{ url: 'https://example.invalid/first.mp4' }, { url: 'https://example.invalid/second.mp4' }];
  assert.throws(() => parseBilibiliResponse(view, { code: 0, data: { durl: parts } }, source), (e: unknown) => e instanceof DownloadError && e.code === 'UNSUPPORTED');
  assert.equal(parseBilibiliResponse(view, { code: 0, data: { durl: parts.slice(0, 1) } }, source)[0].url, parts[0].url);
});
