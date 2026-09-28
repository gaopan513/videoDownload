export type Headers = Record<string, string>;
export interface Context { headers: Headers; cookies: { name: string; value: string; domain: string; path: string; secure: boolean }[]; origin: string }
export interface Candidate { id: string; title: string; url: string; source: string; kind: 'mp4' | 'hls'; quality?: string; audioUrl?: string; audioName?: string; context: Context }
export type PublicCandidate = Omit<Candidate, 'url' | 'audioUrl' | 'context'>;
export type TaskState = 'queued' | 'downloading' | 'paused' | 'merging' | 'confirm' | 'complete' | 'failed' | 'cancelled';
export interface TaskView { id: string; title: string; source: string; kind: string; state: TaskState; done: number; total: number; speed: number; message?: string; output?: string; directory: string; mode: 'mp4' | 'mkv' | 'transcode'; deep: boolean }
export interface Settings { directory: string; tasks: number; concurrency: number; proxy: string; deep: boolean }
export interface Job { id: string; candidate: Candidate; directory: string; concurrency: number; proxy: string; mode: 'mp4' | 'mkv' | 'transcode'; deep: boolean; ffmpeg: string; ffprobe: string }
export type EngineEvent = { type: 'progress'; done: number; total: number; speed: number } | { type: 'stage'; state: TaskState; message?: string };
export interface Bridge {
  init(): Promise<{ settings: Settings; tasks: TaskView[]; tools: string }>;
  resolve(url: string): Promise<PublicCandidate[]>;
  cancelResolve(): Promise<void>;
  add(id: string, directory: string): Promise<void>;
  control(id: string, action: string): Promise<void>;
  clearCompleted(): Promise<number>;
  chooseDirectory(): Promise<string | undefined>;
  saveSettings(settings: Settings): Promise<void>;
  openOutput(id: string): Promise<void>;
  onTasks(cb: (tasks: TaskView[]) => void): () => void;
}
declare global { interface Window { harbor: Bridge } }
