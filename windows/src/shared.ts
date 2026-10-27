export type Headers = Record<string, string>;
export interface Context { headers: Headers; cookies: { name: string; value: string; domain: string; path: string; secure: boolean }[]; origin: string }
export interface EpisodeSource { siteId: string; siteName: string; title: string; line: string; episode: string; playUrl: string; batchId: string }
export interface Candidate { id: string; title: string; url: string; source: string; kind: 'mp4' | 'hls' | 'youtube'; quality?: string; audioUrl?: string; audioName?: string; ytHeight?: number; context: Context; episode?: EpisodeSource }
export type PublicCandidate = Omit<Candidate, 'url' | 'audioUrl' | 'context' | 'episode'>;
export type SiteAdapter = 'sotvla' | 'dmxq' | 'dushe' | 'myui' | 'none';
export type WebSearchEngine = 'google' | 'duckduckgo';
export interface Site { id: string; name: string; url: string; adapter: SiteAdapter; enabled: boolean }
export interface SearchResult { id: string; siteId: string; title: string; url: string; cover: string; year: string; update: string; source: string }
export interface SearchPage { siteId: string; items: SearchResult[]; hasMore: boolean }
export interface Episode { id: string; name: string; url: string }
export interface TitleDetail extends SearchResult { lines: { id: string; name: string; episodes: Episode[] }[] }
export interface ImportItem { index: number; site?: Site; status: 'new' | 'duplicate' | 'conflict' | 'invalid'; localId?: string; reason?: string }
export type TaskState = 'queued' | 'resolving' | 'choice' | 'downloading' | 'paused' | 'merging' | 'confirm' | 'complete' | 'failed' | 'cancelled';
export interface TaskView { id: string; title: string; source: string; kind: string; state: TaskState; done: number; total: number; speed: number; message?: string; output?: string; directory: string; mode: 'mp4' | 'mkv' | 'transcode'; deep: boolean; batchKey?: string; choices?: PublicCandidate[] }
export interface Settings { directory: string; tasks: number; concurrency: number; proxy: string; deep: boolean }
export interface Job { id: string; candidate: Candidate; directory: string; concurrency: number; proxy: string; mode: 'mp4' | 'mkv' | 'transcode'; deep: boolean; ffmpeg: string; ffprobe: string; ytdlp: string }
export type EngineEvent = { type: 'progress'; done: number; total: number; speed: number } | { type: 'stage'; state: TaskState; message?: string };
export interface Bridge {
  visitMeta(url: string): Promise<void>;
  init(): Promise<{ settings: Settings; tasks: TaskView[]; tools: string }>;
  resolve(url: string): Promise<PublicCandidate[]>;
  cancelResolve(): Promise<void>;
  add(id: string, directory: string): Promise<void>;
  control(id: string, action: string): Promise<void>;
  clearCompleted(): Promise<number>;
  deleteRecord(id: string): Promise<{ cleanupFailed: boolean }>;
  chooseDirectory(): Promise<string | undefined>;
  saveSettings(settings: Settings): Promise<void>;
  openOutput(id: string): Promise<void>;
  onTasks(cb: (tasks: TaskView[]) => void): () => void;
  sites(): Promise<Site[]>;
  saveSites(sites: Site[]): Promise<void>;
  previewSites(raw: string): Promise<ImportItem[]>;
  importSites(raw: string, replace: number[]): Promise<Site[]>;
  exportSites(): Promise<string | undefined>;
  openWebSearch(engine: WebSearchEngine, query: string): Promise<boolean>;
  search(query: string, siteIds: string[], page?: number, siteId?: string, requestId?: string): Promise<string>;
  cancelSearch(): Promise<void>;
  onSearch(cb: (value: { requestId: string; siteId: string; page: number; result?: SearchPage; error?: string }) => void): () => void;
  cover(siteId: string, url: string): Promise<string>;
  detail(result: SearchResult): Promise<TitleDetail>;
  visitSite(siteId: string): Promise<void>;
  clearSiteLogin(siteId: string): Promise<void>;
  batch(detail: TitleDetail, lineId: string, episodeIds: string[], directory: string, batchId: string): Promise<number>;
  chooseCandidate(taskId: string, candidateId: string): Promise<void>;
}
declare global { interface Window { harbor: Bridge } }
