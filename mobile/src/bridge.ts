import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
export interface Candidate { id: string; title: string; kind: string; quality: string; codec: 'supported' | 'unknown' | 'unsupported'; message: string }
export interface TaskView { id: string; title: string; state: string; done: number; total: number; message: string }
export interface HarborNative {
  snapshot(): Promise<{ tasks: TaskView[]; prototype: boolean }>;
  deleteRecord(options: { id: string }): Promise<void>;
  resolve(options: { url: string; interactive: boolean }): Promise<{ candidates: Candidate[] }>;
  add(options: { id: string; allowUnknown: boolean }): Promise<void>;
  inspect(options: { id: string }): Promise<{ codec: string; message: string }>;
  control(options: { id: string; action: 'pause' | 'resume' | 'cancel' | 'retry' }): Promise<void>;
  exportFile(options: { id: string; destination: 'share' | 'photos' }): Promise<void>;
  addListener(event: 'tasks', listener: (data: { tasks: TaskView[] }) => void): Promise<PluginListenerHandle>;
}
export const native = Capacitor.getPlatform() === 'ios';
export const harbor = registerPlugin<HarborNative>('Harbor');
