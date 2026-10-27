import type { VideoCandidate } from '../shared/types';

export interface DownloadProgress {
  taskId: string;
  totalSegments: number;
  completedSegments: number;
  percentage: number;
  speed: string;
  stage: 'preparing' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';
  errorMessage?: string;
}
export type ProgressCallback = (progress: DownloadProgress) => void;

// Both direct files and HLS run in offscreen; the popup only starts and observes tasks.
export async function downloadDirectMp4(candidate: VideoCandidate, onProgress?: ProgressCallback): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'START_NATIVE_DOWNLOAD', candidate });
  if (response?.error) throw new Error(response.error);
  if (!response?.task) throw new Error('后台下载服务未响应');
  const task = response.task;
  onProgress?.({ taskId: candidate.id, totalSegments: 0, completedSegments: 0,
    percentage: task.percentage, speed: task.errorMessage || 'Chrome 后台下载', stage: task.stage });
  if (task.stage === 'failed') throw new Error(task.errorMessage || '下载失败');
}

export async function downloadHlsStream(candidate: VideoCandidate, preferredQuality?: string, onProgress?: ProgressCallback): Promise<void> {
  return downloadDirectMp4({ ...candidate, quality: preferredQuality }, onProgress);
}
