// 一次性端到端验证：走真实 YouTube 下载全链路（yt-dlp 解析 + engine 落盘），验证产出可播放 MP4。
// 用法: npx tsx scripts/verify-youtube.mts
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveYoutubeCandidates } from '../src/core/ytdlp';
import { download } from '../src/core/engine';
import { probe } from '../src/core/media';
import type { Job } from '../src/shared';

const exe = path.resolve('build/yt-dlp.exe');
const ffmpeg = path.resolve('node_modules/ffmpeg-static/ffmpeg.exe');
const ffprobe = path.resolve('node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
const url = 'https://www.youtube.com/watch?v=EMdSr1OciVc';
const directory = path.resolve('.test-data', 'yt-e2e-' + randomUUID());
const signal = AbortSignal.timeout(420000);

await mkdir(directory, { recursive: true });
try {
  console.log('[1/3] 解析候选…');
  const cands = await resolveYoutubeCandidates(exe, url, '', signal);
  const qualities = cands.map(c => c.quality).join(' | ');
  console.log('  清晰度档位(' + cands.length + '):', qualities);
  if (!cands.length) throw new Error('未返回候选');
  if (new Set(cands.map(c => c.kind)).size !== 1 || cands[0].kind !== 'youtube') throw new Error('kind 应为 youtube');

  const chosen = cands[cands.length - 1]; // 最低清晰度，最快下载
  console.log('[2/3] 下载并落盘:', chosen.quality, '· title:', chosen.title.slice(0, 40));

  const job: Job = {
    id: randomUUID(),
    candidate: chosen,
    directory,
    concurrency: 4,
    proxy: '',
    mode: 'mp4',
    deep: false,
    ffmpeg,
    ffprobe,
    ytdlp: exe
  };

  let lastLog = 0;
  const out = await download(job, signal, e => {
    if (e.type === 'stage') console.log('  stage:', e.state, e.message || '');
    else {
      const now = Date.now();
      if (now - lastLog > 4000 || (e.total > 0 && e.done === e.total)) {
        lastLog = now;
        const pct = e.total ? ((e.done / e.total) * 100).toFixed(0) : '?';
        console.log(`  progress: ${(e.done / 1e6).toFixed(1)}MB / ${(e.total / 1e6).toFixed(1)}MB (${pct}%)`);
      }
    }
  });

  console.log('[3/3] 校验输出:', out);
  const { size } = await stat(out);
  const info = await probe(ffprobe, out, signal);
  const hasVideo = info.streams.some((s: any) => s.codec_type === 'video');
  const hasAudio = info.streams.some((s: any) => s.codec_type === 'audio');
  const dur = Number(info.format?.duration);
  const vcodec = info.streams.find((s: any) => s.codec_type === 'video')?.codec_name;
  console.log(`  size=${(size / 1e6).toFixed(2)}MB duration=${dur}s video=${hasVideo}(${vcodec}) audio=${hasAudio}`);
  if (!(dur > 0) || !hasVideo || !hasAudio || size <= 0) throw new Error('输出不可播放');
  console.log('E2E OK — 可播放 MP4 产出于:', out);
} finally {
  await rm(directory, { recursive: true, force: true }).catch(() => {});
}
