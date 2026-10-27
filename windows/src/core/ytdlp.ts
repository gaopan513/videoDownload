import { spawn, execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { DownloadError } from './net';
import { buildYoutubeSelector, parseYoutubeMeta, parseYoutubeProgress, proxyToYtDlp } from './youtube';
import type { Candidate } from '../shared';

const MEDIA_EXT = /\.(mp4|mkv|webm|m4v|mov)$/i;
const TEMP_EXT = /\.(part|ytdl|temp|f\d+\.\w+)$/i;

export interface YtProgress { done: number; total: number; speed: number; merging: boolean }

/** Windows 下终止整棵进程树（含 yt-dlp 派生的 ffmpeg），避免合并阶段留下孤儿进程。 */
function killTree(pid: number) {
  execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
}

interface ProcResult { stdout: string; stderr: string; code: number | null; signal: string | null }

function runProcess(exe: string, args: string[], proxy: string, signal: AbortSignal, onLine?: (line: string, stream: 'out' | 'err') => void): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const full = ['--no-playlist', '--no-warnings', ...(proxy ? ['--proxy', proxyToYtDlp(proxy)] : []), ...args];
    const child = spawn(exe, full, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let capErr = '';
    let bufOut = '';
    let bufErr = '';
    const feed = (chunk: Buffer, isErr: boolean) => {
      const text = chunk.toString();
      if (!isErr && stdout.length < 8 * 1024 * 1024) stdout += text;
      if (isErr && capErr.length < 16 * 1024) capErr += text;
      let buf = isErr ? bufErr : bufOut;
      buf += text;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';
      if (isErr) bufErr = buf; else bufOut = buf;
      for (const line of lines) if (line.trim()) onLine?.(line, isErr ? 'err' : 'out');
    };
    child.stdout.on('data', (b: Buffer) => feed(b, false));
    child.stderr.on('data', (b: Buffer) => feed(b, true));
    const onAbort = () => killTree(child.pid!);
    if (signal.aborted) { killTree(child.pid!); } else signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', err => {
      signal.removeEventListener('abort', onAbort);
      // yt-dlp 缺失仅影响 YouTube 通道，不应让其他平台下载崩溃。
      reject((err as NodeJS.ErrnoException).code === 'ENOENT'
        ? new DownloadError('MEDIA', '未找到 yt-dlp 组件，YouTube 下载不可用；请确认应用安装完整')
        : err);
    });
    child.on('exit', (code, sig) => {
      signal.removeEventListener('abort', onAbort);
      if (bufOut.trim()) onLine?.(bufOut, 'out');
      if (bufErr.trim()) onLine?.(bufErr, 'err');
      if (signal.aborted) { reject(new DownloadError('ABORT', '已取消')); return; }
      resolve({ stdout, stderr: capErr, code, signal: sig });
    });
  });
}

/** 翻译 yt-dlp 的典型错误为中文提示。 */
function translateError(raw: string): DownloadError {
  const text = raw.toLowerCase();
  let message = 'YouTube 解析失败，请检查网络或代理后重试';
  if (/private video|登录|sign in to confirm|confirm your age|age-restricted|members-only|members only/.test(raw)) {
    message = '该视频为私密、年龄限制或会员内容，无法直接下载';
  } else if (/video unavailable|video has been removed|not available|unavailable video|copyright/.test(raw)) {
    message = '视频不可用、已被删除或因版权限制无法访问';
  } else if (/bot|nsig|sign in to confirm you/.test(text)) {
    message = 'YouTube 要求人机验证，请稍后重试或在设置中配置代理';
  } else if (/403|forbidden|http error 4/.test(text)) {
    message = '视频地址被拒绝（403），可能触发了访问限制，请配置代理或稍后重试';
  } else if (/timed? ?out|timed out/.test(text)) {
    message = '连接 YouTube 超时，请检查网络或代理';
  } else if (/unsupported url/.test(text)) {
    message = '该链接不被支持，请确认是有效的 YouTube 视频页';
  }
  return new DownloadError('DISCOVERY', message);
}

/** 拉取并解析视频元数据，生成清晰度候选（不下载）。 */
export async function resolveYoutubeCandidates(exe: string, source: string, proxy: string, signal: AbortSignal): Promise<Candidate[]> {
  const { stdout, stderr, code } = await runProcess(
    exe,
    ['--dump-single-json', '--ignore-no-formats-error', source],
    proxy,
    signal
  );
  if (code !== 0) throw translateError(stderr || '解析失败');
  let data: any;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new DownloadError('DISCOVERY', 'YouTube 返回的数据格式无法识别');
  }
  return parseYoutubeMeta(data, source);
}

/** 调用 yt-dlp 下载并合并为单个 MP4，返回临时目录内的最终文件路径。 */
export async function downloadYoutubeVideo(
  exe: string,
  ffmpeg: string,
  candidate: Candidate,
  dir: string,
  proxy: string,
  signal: AbortSignal,
  emit: (e: { type: 'progress'; done: number; total: number; speed: number } | { type: 'stage'; state: 'downloading' | 'merging'; message?: string }) => void
): Promise<string> {
  const selector = buildYoutubeSelector(candidate.ytHeight);
  const outputTpl = path.join(dir, 'video.%(ext)s').replace(/\\/g, '/');
  const streams = new Map<string, { done: number; total: number }>();
  let lastEmit = 0;
  let lastDone = 0;
  let lastTime = Date.now();
  let merging = false;

  const flush = (force = false) => {
    let done = 0, total = 0;
    for (const s of streams.values()) { done += s.done; total += s.total || 0; }
    const now = Date.now();
    if (force || now - lastEmit >= 250) {
      const speed = Math.max(0, (done - lastDone) * 1000 / Math.max(1, now - lastTime));
      emit({ type: 'progress', done, total, speed });
      lastEmit = now; lastDone = done; lastTime = now;
    }
  };

  let errorTail = '';
  const { code } = await runProcess(
    exe,
    [
      '-f', selector,
      '--merge-output-format', 'mp4',
      '--remux-video', 'mp4',
      '--ffmpeg-location', ffmpeg,
      '--newline',
      '--progress-template', '%(progress)j',
      '-o', outputTpl,
      candidate.source
    ],
    proxy,
    signal,
    (line, stream) => {
      if (stream === 'err') { if (errorTail.length < 4096) errorTail += line + '\n'; return; }
      const p = parseYoutubeProgress(line);
      if (p) {
        const prev = streams.get(p.key);
        // total 可能在 estimate -> exact 间变化，取较大值避免进度回退抖动。
        streams.set(p.key, { done: p.done, total: Math.max(p.total, prev?.total || 0) });
        flush();
        return;
      }
      if (!merging && /merg|mux|ffmpeg/i.test(line)) {
        merging = true;
        emit({ type: 'stage', state: 'merging', message: '正在合并音视频' });
      }
    }
  );

  if (signal.aborted) throw new DownloadError('ABORT', '已取消');
  if (code !== 0) {
    if (/nsig|bot|403|forbidden|timed? ?out|unavailable|sign in|private|copyright/i.test(errorTail)) throw translateError(errorTail);
    throw new DownloadError('MEDIA', 'YouTube 下载或合并失败，请重试；若反复失败可更换清晰度');
  }

  flush(true);
  const files = (await readdir(dir).catch(() => [] as string[]))
    .filter(f => MEDIA_EXT.test(f) && !TEMP_EXT.test(f) && !f.endsWith('.json'));
  const preferred = files.find(f => /^video\.mp4$/i.test(f)) || files.sort((a, b) => b.length - a.length)[0];
  if (!preferred) throw new DownloadError('MEDIA', '下载完成但未找到输出文件，临时数据可能不完整');
  return path.join(dir, preferred);
}
