import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('harbor', {
  clearCompleted: () => ipcRenderer.invoke('clear-completed'),
  init: () => ipcRenderer.invoke('init'), resolve: (url: string) => ipcRenderer.invoke('resolve', url), cancelResolve: () => ipcRenderer.invoke('cancel-resolve'),
  add: (id: string, directory: string) => ipcRenderer.invoke('add', id, directory), control: (id: string, action: string) => ipcRenderer.invoke('control', id, action),
  chooseDirectory: () => ipcRenderer.invoke('choose-directory'), saveSettings: (s: unknown) => ipcRenderer.invoke('settings', s), openOutput: (id: string) => ipcRenderer.invoke('open-output', id),
  onTasks: (cb: (t: unknown) => void) => { const handler = (_: unknown, value: unknown) => cb(value); ipcRenderer.on('tasks', handler); return () => ipcRenderer.removeListener('tasks', handler); }
});
