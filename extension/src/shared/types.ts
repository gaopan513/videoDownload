export interface VideoCandidate {
  id: string;
  tabId?: number;
  url: string;
  title: string;
  sourceUrl: string;
  kind: 'mp4' | 'hls' | 'webm' | 'unknown';
  quality?: string;
  size?: number; // 字节数（如果已知）
  headers?: Record<string, string>;
  details?: {
    playlists?: Array<{
      quality: string;
      url: string;
      bandwidth?: number;
    }>;
  };
  capturedAt: number;
  playerConfig?: boolean;
  platform?: 'Instagram' | 'Facebook';
}

export interface SeriesEpisode { id: string; name: string; url: string; }
export interface EpisodeSelection extends SeriesEpisode { seriesTitle: string; seriesUrl: string; lineId: string; lineName: string; }

export type ExtensionMessage =
  | { type: 'CANDIDATE_DETECTED'; candidate: VideoCandidate }
  | { type: 'GET_TAB_CANDIDATES'; tabId: number }
  | { type: 'TAB_CANDIDATES_RESPONSE'; candidates: VideoCandidate[] }
  | { type: 'DOWNLOAD_TASK_START'; candidate: VideoCandidate }
  | { type: 'DOWNLOAD_TASK_PROGRESS'; taskId: string; progress: number; speed: string; state: 'downloading' | 'decrypting' | 'merging' | 'completed' | 'failed'; message?: string };
