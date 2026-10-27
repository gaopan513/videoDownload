import { app } from 'electron';
import { resolveYoutubeCandidates } from '../core/ytdlp';
import { resolveYtDlpBundlePath } from '../core/youtube';
import type { Candidate } from '../shared';

export function youtubeDlpPath(): string {
  return resolveYtDlpBundlePath(app.isPackaged, app.getAppPath(), process.resourcesPath);
}

export async function resolveYoutube(source: string, proxy: string, signal: AbortSignal): Promise<Candidate[]> {
  return resolveYoutubeCandidates(youtubeDlpPath(), source, proxy, signal);
}
