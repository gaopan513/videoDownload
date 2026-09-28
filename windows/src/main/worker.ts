import { download } from '../core/engine';
import { cleanError, DownloadError, setProxyResolver } from '../core/net';
import type { Job } from '../shared';
const port = (process as any).parentPort;
const controller = new AbortController();
const pending = new Map<number, (value: string) => void>(); let next = 0;
setProxyResolver(url => new Promise(resolve => { const id = next++; pending.set(id, resolve); port.postMessage({ type: 'proxy', url, id }); }));
port.on('message', async ({ data }: { data: any }) => {
  if (data.type === 'abort') { controller.abort(); return; }
  if (data.type === 'proxy-result') { pending.get(data.id)?.(data.value); pending.delete(data.id); return; }
  if (data.type !== 'start') return;
  try { const output = await download(data.job as Job, controller.signal, event => port.postMessage(event)); port.postMessage({ type: 'complete', output }); }
  catch (e) { port.postMessage({ type: 'error', code: controller.signal.aborted ? 'ABORT' : e instanceof DownloadError ? e.code : 'UNKNOWN', message: cleanError(e), ...(process.env.STREAMHARBOR_TEST_DATA ? { diagnostic: (e as Error).stack?.split('\n').slice(1, 6).join('\n') } : {}) }); }
});
