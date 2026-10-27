import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { EventEmitter } from 'node:events';
import path from 'node:path';

// Execute the actual IPC handlers, replacing only process/network/filesystem boundaries.
const source = readFileSync(new URL('../src/main/main.ts', import.meta.url), 'utf8');
const handlers = ts.transpile(source.slice(source.indexOf("  handle('control',"), source.indexOf("  handle('clear-completed',")), { target: ts.ScriptTarget.ES2022 });
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
function setup(remove = async () => {}) {
  const id = '00000000-0000-0000-0000-000000000000';
  const task = { id, state: 'failed', title: 'Video', done: 10, total: 100 };
  const candidate = { source: 'https://example.test/watch', kind: 'mp4', quality: '720p', title: 'Video', url: 'https://example.test/old.mp4' };
  const tasks = new Map([[id, task]]), secrets = new Map([[id, candidate]]), callbacks = new Map();
  const discovery = deferred(), discovering = deferred(); let calls = 0;
  const sandbox = {
    handle: (name, fn) => callbacks.set(name, fn), tasks, secrets, workers: new Map(),
    refreshing: new Set(), refreshed: new Set(), reparseControllers: new Map(),
    deletingRecords: new Set(), taskChoices: new Map(), episodeSources: new Map(), stoppedForDeletion: new Map(),
    resolvingTaskId: undefined, settings: { proxy: '', tasks: 1 }, AbortSignal, AbortController,
    DownloadError: class extends Error { constructor(code, message) { super(message); this.code = code; } },
    discover: () => { calls++; discovering.resolve(); return discovery.promise; }, rm: remove,
    tempDirectory: () => '<temporary media>', save: async () => {}, saveBackground: () => {},
    emit: () => {}, schedule: async () => {}, cleanError: e => e.message, setTimeout
  };
  vm.runInNewContext(handlers, sandbox);
  return { id, task, candidate, tasks, secrets, discovery, discovering, sandbox, calls: () => calls,
    control: action => callbacks.get('control')(id, action),
    deleteRecord: () => callbacks.get('delete-record')(id) };
}
test('restart succeeds and resets progress when no other action intervenes', async () => {
  const s = setup(); const pending = s.control('restart');
  s.discovery.resolve([{ ...s.candidate, url: 'https://example.test/new.mp4' }]);
  await pending;
  assert.equal(s.task.state, 'queued'); assert.equal(s.task.done, 0);
  assert.equal(s.secrets.get(s.id).url, 'https://example.test/new.mp4');
});
for (const action of ['cancel', 'pause', 'delete']) test(`${action} during restart cannot be undone by a late discovery`, async () => {
  const s = setup(); const pending = s.control('restart');
  if (action === 'delete') await s.deleteRecord(); else await s.control(action);
  s.discovery.resolve([{ ...s.candidate, url: 'https://example.test/new.mp4' }]);
  await pending;
  if (action === 'delete') assert.equal(s.tasks.has(s.id), false);
  else assert.equal(s.task.state, action === 'pause' ? 'paused' : 'cancelled');
  if (action !== 'pause') assert.equal(s.secrets.has(s.id), false);
  else assert.equal(s.secrets.get(s.id).url, s.candidate.url);
});
test('retry and repeated restart do not race an in-flight restart', async () => {
  const s = setup(); const pending = s.control('restart');
  await s.control('retry');
  assert.notEqual(s.task.state, 'queued');
  const second = s.control('restart');
  assert.equal(s.calls(), 1);
  s.discovery.resolve([s.candidate]); await Promise.all([pending, second]);
  assert.equal(s.task.state, 'queued');
});
test('cancel during temporary-file cleanup cannot resurrect a restart', async () => {
  const cleanup = deferred(), started = deferred(); let removals = 0;
  const s = setup(async () => { if (++removals === 1) { started.resolve(); await cleanup.promise; } });
  const pending = s.control('restart'); s.discovery.resolve([s.candidate]);
  await started.promise; await s.control('cancel'); cleanup.resolve(); await pending;
  assert.equal(s.task.state, 'cancelled'); assert.equal(s.secrets.has(s.id), false);
});
test('failed restart preserves credentials and recovery progress for another attempt', async () => {
  const s = setup(); const pending = s.control('restart'); s.discovery.reject(new Error('network failure'));
  await assert.rejects(pending, /network failure/);
  assert.equal(s.task.state, 'failed'); assert.equal(s.task.done, 10);
  assert.equal(s.secrets.get(s.id), s.candidate);
  assert.equal(s.sandbox.refreshing.size, 0); assert.equal(s.sandbox.reparseControllers.size, 0);
});
for (const action of ['cancel', 'pause', 'delete']) test(`${action} also stops automatic expired-URL refresh`, async () => {
  const s = setup(); const child = new EventEmitter(); let forks = 0;
  child.kill = () => {}; child.postMessage = () => {};
  Object.assign(s.sandbox, { quitting: false, toolStatus: '', path, __dirname: '.', ffmpeg: '', ffprobe: '', ytdlp: '',
    process: { env: {} }, utilityProcess: { fork: () => { forks++; return child; } } });
  vm.runInNewContext(ts.transpile(source.slice(source.indexOf('async function schedule()'), source.indexOf('function handle(')), { target: ts.ScriptTarget.ES2022 }), s.sandbox);
  s.task.state = 'queued'; await s.sandbox.schedule();
  const pending = child.listeners('message')[0]({ type: 'error', code: 'AUTH' });
  await s.discovering.promise;
  if (action === 'delete') await s.deleteRecord(); else await s.control(action);
  s.discovery.resolve([s.candidate]); await pending;
  assert.equal(forks, 1);
  if (action === 'delete') assert.equal(s.tasks.has(s.id), false);
  else assert.equal(s.task.state, action === 'pause' ? 'paused' : 'cancelled');
  if (action !== 'pause') assert.equal(s.secrets.has(s.id), false);
});
