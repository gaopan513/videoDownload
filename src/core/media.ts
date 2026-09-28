import { spawn } from 'node:child_process';
import { DownloadError } from './net';
export function run(exe: string, args: string[], signal: AbortSignal, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const p = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal, cwd }); let output = '';
    p.stdout.on('data', b => { if (output.length < 4e6) output += b.toString(); });
    p.stderr.on('data', () => {}); // Media input paths and tokens must not reach logs.
    p.on('error', reject); p.on('exit', code => code === 0 ? resolve(output) : reject(new DownloadError('MEDIA', '媒体处理失败，请检查分片完整性或选择转码')));
  });
}
export async function probe(exe: string, path: string, signal: AbortSignal) {
  const result = JSON.parse(await run(exe, ['-v', 'error', ...(path.endsWith('.m3u8') ? ['-allowed_extensions', 'ALL', '-protocol_whitelist', 'file,crypto,data'] : []), '-show_streams', '-show_format', '-of', 'json', path.replace(/\\/g, '/')], signal));
  if (!result.streams?.some((s: any) => s.codec_type === 'video')) throw new DownloadError('MEDIA', '输出中没有有效视频流');
  return result;
}
