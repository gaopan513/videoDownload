import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, rm, stat, open, link } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { EngineEvent, Job } from '../shared';
import { Network, DownloadError, pool, retry } from './net';
import { segments, decrypt, type Segment } from './hls';
import { probe, run } from './media';

export const hash = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
export function safeName(name: string) { const value = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || 'video'; return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value) ? '_' + value : value; }
export function tempDirectory(job: Pick<Job, 'directory' | 'id'>) { if (!/^[a-f0-9-]{36}$/.test(job.id)) throw new Error('Invalid task ID'); return path.join(job.directory, '.streamharbor', job.id); }
async function atomic(file: string, value: unknown) { await writeFile(file + '.new', JSON.stringify(value)); await rename(file + '.new', file); }
async function json(file: string): Promise<any> { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return undefined; } }
async function checksum(file: string) { const h = createHash('sha256'); for await (const b of createReadStream(file)) h.update(b); return h.digest('hex'); }
async function exists(file: string) { try { return await stat(file); } catch { return undefined; } }
export async function download(job: Job, signal: AbortSignal, emit: (e: EngineEvent) => void): Promise<string> {
  const dir = tempDirectory(job); await mkdir(dir, { recursive: true });
  const net = new Network(job.candidate.context, job.proxy);
  let previous = 0, previousTime = Date.now();
  const progress = (done: number, total: number) => { const now = Date.now(); if (now - previousTime >= 250 || done === total) { emit({ type: 'progress', done, total, speed: Math.max(0, (done - previous) * 1000 / Math.max(1, now - previousTime)) }); previous = done; previousTime = now; } };
  try {
    emit({ type: 'stage', state: 'downloading' });
    let input: string, audio: string | undefined; let duration = 0;
    if (job.candidate.kind === 'mp4') input = await mp4();
    else {
      const video = await hls(job.candidate.url, 'video'); input = video.path; duration = video.duration;
      if (job.candidate.audioUrl) audio = (await hls(job.candidate.audioUrl, 'audio')).path;
    }
    signal.throwIfAborted(); emit({ type: 'stage', state: 'merging' });
    const info = await probe(job.ffprobe, input, signal);
    const compatible = info.streams.every((s: any) => s.codec_type === 'video' ? ['h264', 'hevc', 'av1', 'mpeg4'].includes(s.codec_name) : s.codec_type === 'audio' ? ['aac', 'mp3', 'ac3', 'eac3', 'alac'].includes(s.codec_name) : true);
    if (job.mode === 'mp4' && !compatible) throw new DownloadError('CONFIRM', '源编码不适合直接输出 MP4，请选择转码 MP4 或无损 MKV');
    const extension = job.mode === 'mkv' ? 'mkv' : 'mp4'; const output = path.join(dir, 'output.' + extension);
    if (job.candidate.kind === 'mp4' && job.mode === 'mp4') {
      // Still remux so a misleading .mp4 URL cannot bypass format validation.
    }
    const args = ['-v', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,crypto,data', ...(input.endsWith('.m3u8') ? ['-allowed_extensions', 'ALL'] : []), '-i', input.replace(/\\/g, '/')];
    if (audio) args.push('-protocol_whitelist', 'file,crypto,data', '-allowed_extensions', 'ALL', '-i', audio.replace(/\\/g, '/'), '-map', '0:v:0', '-map', '1:a:0');
    else args.push('-map', '0:v:0', '-map', '0:a?');
    args.push(...(job.mode === 'transcode' ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '192k'] : ['-c', 'copy']));
    if (extension === 'mp4') args.push('-movflags', '+faststart');
    args.push(output);
    try { await run(job.ffmpeg, args, signal); } catch (e) { if (!signal.aborted && job.mode === 'mp4' && e instanceof DownloadError) throw new DownloadError('CONFIRM', '无法无损封装 MP4，请选择转码或 MKV；也可重试检查源分片'); throw e; }
    const result = await probe(job.ffprobe, output, signal);
    const actual = Number(result.format?.duration);
    if (!(actual > 0) || (duration > 0 && Math.abs(actual - duration) > Math.max(2, duration * 0.02))) throw new DownloadError('MEDIA', '输出时长异常，已保留分片供重试');
    if (audio && !result.streams.some((s: any) => s.codec_type === 'audio')) throw new DownloadError('MEDIA', '独立音轨合并失败');
    if (job.deep) { emit({ type: 'stage', state: 'merging', message: '正在逐帧解码校验' }); await run(job.ffmpeg, ['-v', 'error', '-xerror', '-nostdin', '-i', output, '-f', 'null', '-'], signal); }
    signal.throwIfAborted();
    let final = '';
    for (let i = 0; i < 10000; i++) {
      const dest = path.join(job.directory, `${safeName(job.candidate.title)}${i ? ` (${i})` : ''}.${extension}`);
      try {
        try { await link(output, dest); }
        catch (e) {
          if (!['ENOTSUP', 'EPERM', 'EINVAL', 'EXDEV'].includes((e as NodeJS.ErrnoException).code || '')) throw e;
          // FAT/exFAT do not implement hard links. Reserve exclusively before rename.
          const reservation = await open(dest, 'wx'); await reservation.close();
          try { await rename(output, dest); } catch (err) { await rm(dest, { force: true }); throw err; }
        }
        final = dest; break;
      } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue; throw e; }
    }
    if (!final) throw new DownloadError('PATH', '同名文件过多，请修改文件名');
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    return final;
  } finally { net.close(); }

  async function mp4() {
    const res = await retry(() => net.open(job.candidate.url, signal, { Range: 'bytes=0-0' }), signal);
    const match = /^bytes 0-0\/(\d+)$/.exec(String(res.headers['content-range']));
    const ranged = res.statusCode === 206 && !!match;
    const total = ranged ? Number(match![1]) : Number(res.headers['content-length'] || 0);
    const etag = res.headers.etag && !res.headers.etag.startsWith('W/') ? res.headers.etag : undefined;
    const modified = res.headers['last-modified']; const validator = etag || modified;
    res.destroy();
    if (!ranged) {
      emit({ type: 'stage', state: 'downloading', message: '服务器不支持分段续传；暂停后继续将重新下载' });
      const target = path.join(dir, 'input.mp4');
      await retry(async () => {
        const r = await net.open(job.candidate.url, signal); let received = 0;
        await pipeline(r, new Transform({ transform(chunk, _, cb) { received += chunk.length; progress(received, Number(r.headers['content-length'] || 0)); cb(null, chunk); } }), createWriteStream(target), { signal });
        if (r.headers['content-length'] && received !== Number(r.headers['content-length'])) throw new DownloadError('RETRY', '下载字节数不完整');
      }, signal);
      return target;
    }
    const stateFile = path.join(dir, 'mp4.json'); let state = await json(stateFile);
    const identity = hash(JSON.stringify({ total, validator }));
    if (state && (state.identity !== identity || !validator)) {
      throw new DownloadError('CHANGED', '资源已变化或无法确认一致性；请重新下载，旧数据已保留');
    }
    const chunkSize = 4 * 1024 * 1024;
    state ||= { identity, parts: {} };
    let done = 0;
    const parts = Array.from({ length: Math.ceil(total / chunkSize) }, (_, i) => ({ i, start: i * chunkSize, end: Math.min(total - 1, (i + 1) * chunkSize - 1) }));
    for (const p of parts) { const file = path.join(dir, `part-${p.i}`); if (state.parts[p.i] && (await exists(file))?.size === p.end - p.start + 1 && await checksum(file) === state.parts[p.i]) done += p.end - p.start + 1; else delete state.parts[p.i]; }
    progress(done, total);
    let saving = Promise.resolve();
    await pool(parts, job.concurrency, async p => {
      if (state.parts[p.i]) return;
      const dest = path.join(dir, `part-${p.i}`);
      await retry(async () => {
        const r = await net.open(job.candidate.url, signal, { Range: `bytes=${p.start}-${p.end}`, ...(validator ? { 'If-Range': validator } : {}) });
        if (r.statusCode !== 206 || r.headers['content-range'] !== `bytes ${p.start}-${p.end}/${total}`) { r.destroy(); throw new DownloadError('CHANGED', '服务器分段响应变化，已停止以避免损坏文件'); }
        let n = 0; await pipeline(r, new Transform({ transform(b, _, cb) { n += b.length; cb(null, b); } }), createWriteStream(dest + '.tmp'), { signal });
        if (n !== p.end - p.start + 1) throw new DownloadError('RETRY', '分段长度不完整');
        await rename(dest + '.tmp', dest);
      }, signal);
      state.parts[p.i] = await checksum(dest); done += p.end - p.start + 1; progress(done, total);
      saving = saving.then(() => atomic(stateFile, state)); await saving;
    });
    const target = path.join(dir, 'input.mp4'); const handle = await open(target, 'w');
    try { for (const p of parts) { signal.throwIfAborted(); const b = await readFile(path.join(dir, `part-${p.i}`)); await handle.write(b, 0, b.length, p.start); } } finally { await handle.close(); }
    return target;
  }
  async function hls(url: string, prefix: string) {
    const manifest = await retry(() => net.bytes(url, signal, {}, 4 * 1024 * 1024), signal);
    const list = segments(manifest.data.toString(), url);
    const fingerprint = hash(JSON.stringify(list)); const stateFile = path.join(dir, prefix + '.json'); let state = await json(stateFile);
    if (state && state.fingerprint !== fingerprint) throw new DownloadError('CHANGED', '播放列表发生变化，无法安全续传；旧数据已保留');
    state ||= { fingerprint, parts: {} }; let saving = Promise.resolve(); let finished = 0;
    const keyCache = new Map<string, Promise<Buffer>>();
    async function fetchPart(part: Pick<Segment, 'url' | 'range' | 'key'>, keyEpoch: number) {
      const headers = part.range ? { Range: `bytes=${part.range.offset}-${part.range.offset + part.range.length - 1}` } : {};
      const r = await retry(() => net.bytes(part.url, signal, headers as Record<string, string>, 256 * 1024 * 1024), signal);
      if (part.range && (r.status !== 206 || r.data.length !== part.range.length || !String(r.headers['content-range']).startsWith(`bytes ${part.range.offset}-${part.range.offset + part.range.length - 1}/`))) throw new DownloadError('RANGE', 'HLS 字节范围响应无效');
      if (!part.key) return r.data;
      const keyId = `${keyEpoch}:${part.key.url}`;
      if (!keyCache.has(keyId)) keyCache.set(keyId, retry(async () => (await net.bytes(part.key!.url, signal, {}, 1024)).data, signal));
      return decrypt(r.data, await keyCache.get(keyId)!, part.key.iv);
    }
    // Key declarations define epochs, even when a server reuses a key URL.
    const epochs = list.map(s => s.epoch);
    await pool(list, job.concurrency, async (s, i) => {
      const file = path.join(dir, `${prefix}-${i}.bin`); const init = path.join(dir, `${prefix}-${i}-init.bin`);
      const record = state.parts[i];
      if (record && await exists(file) && await checksum(file) === record.hash && (!s.map || await exists(init) && await checksum(init) === record.map)) { finished++; progress(finished, list.length); return; }
      const data = await fetchPart(s, epochs[i]); await writeFile(file + '.tmp', data); await rename(file + '.tmp', file);
      let mapHash: string | undefined;
      if (s.map) { const data = await fetchPart(s.map, epochs[i]); await writeFile(init + '.tmp', data); await rename(init + '.tmp', init); mapHash = hash(data); }
      state.parts[i] = { hash: hash(data), map: mapHash }; finished++; progress(finished, list.length);
      saving = saving.then(() => atomic(stateFile, state)); await saving;
    });
    const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-TARGETDURATION:' + Math.ceil(Math.max(...list.map(s => s.duration)))];
    list.forEach((s, i) => { if (s.discontinuity) lines.push('#EXT-X-DISCONTINUITY'); if (s.map) lines.push(`#EXT-X-MAP:URI="${prefix}-${i}-init.bin"`); lines.push(`#EXTINF:${s.duration},`, `${prefix}-${i}.bin`); });
    lines.push('#EXT-X-ENDLIST'); const file = path.join(dir, prefix + '.m3u8'); await writeFile(file, lines.join('\n'));
    return { path: file, duration: list.reduce((sum, s) => sum + s.duration, 0) };
  }
}
