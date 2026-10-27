import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('harbor', {
  visitMeta: (url: string) => ipcRenderer.invoke('visit-meta', url),
  clearCompleted: () => ipcRenderer.invoke('clear-completed'), deleteRecord: (id: string) => ipcRenderer.invoke('delete-record', id),
  init: () => ipcRenderer.invoke('init'), resolve: (url: string) => ipcRenderer.invoke('resolve', url), cancelResolve: () => ipcRenderer.invoke('cancel-resolve'),
  add: (id: string, directory: string) => ipcRenderer.invoke('add', id, directory), control: (id: string, action: string) => ipcRenderer.invoke('control', id, action),
  chooseDirectory: () => ipcRenderer.invoke('choose-directory'), saveSettings: (s: unknown) => ipcRenderer.invoke('settings', s), openOutput: (id: string) => ipcRenderer.invoke('open-output', id),
  onTasks: (cb: (t: unknown) => void) => { const handler = (_: unknown, value: unknown) => cb(value); ipcRenderer.on('tasks', handler); return () => ipcRenderer.removeListener('tasks', handler); }
  ,sites: () => ipcRenderer.invoke('sites'), saveSites: (sites: unknown) => ipcRenderer.invoke('save-sites', sites),
  previewSites: (raw: string) => ipcRenderer.invoke('preview-sites', raw), importSites: (raw: string, replace: number[]) => ipcRenderer.invoke('import-sites', raw, replace),
  exportSites: () => ipcRenderer.invoke('export-sites'),
  openWebSearch: (engine: string, query: string) => ipcRenderer.invoke('open-web-search', engine, query),
  search: (query: string, ids: string[], page?: number, siteId?: string, requestId?: string) => ipcRenderer.invoke('search', query, ids, page, siteId, requestId), cancelSearch: () => ipcRenderer.invoke('cancel-search'),
  onSearch: (cb: (value: unknown) => void) => { const handler = (_: unknown, value: unknown) => cb(value); ipcRenderer.on('search-result', handler); return () => ipcRenderer.removeListener('search-result', handler); },
  cover: (siteId: string, url: string) => ipcRenderer.invoke('cover', siteId, url),
  detail: (result: unknown) => ipcRenderer.invoke('detail', result), visitSite: (id: string) => ipcRenderer.invoke('visit-site', id), clearSiteLogin: (id: string) => ipcRenderer.invoke('clear-site-login', id),
  batch: (detail: unknown, lineId: string, episodeIds: string[], directory: string, batchId: string) => ipcRenderer.invoke('batch', detail, lineId, episodeIds, directory, batchId),
  chooseCandidate: (taskId: string, candidateId: string) => ipcRenderer.invoke('choose-candidate', taskId, candidateId)
});
