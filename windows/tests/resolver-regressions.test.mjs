import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resolverPath = path.join(root, 'src/main/resolver.ts');
const platformsPath = path.join(root, 'src/main/platforms.ts');

// Run the current source with only Electron and network edges replaced; no generated bundle.
function loadSource(entry, overrides, globals = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const localRequire = name => {
      const replacement = overrides(file, name);
      if (replacement !== undefined) return replacement;
      if (!name.startsWith('.')) return require(name);
      const target = path.resolve(path.dirname(file), name);
      return load(existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'index.ts'));
    };
    const context = { module, exports: module.exports, require: localRequire, URL, Headers, Response, AbortController, AbortSignal, Buffer, console, setTimeout, clearTimeout, ...globals };
    vm.runInNewContext(source, context, { filename: file });
    return module.exports;
  }
  return load(entry);
}

function browserHarness(realDomestic = false) {
  const listeners = {}, windows = [];
  const controllers = [];
  let now = 0, nextRequest = 0;
  const ses = {
    setProxy: async () => {}, setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {}, removeListener() {},
    clearStorageData: async () => {}, closeAllConnections: async () => {},
    cookies: { get: async () => [] }, webRequest: {},
    fetch: async () => new Response('video', { headers: { 'content-type': 'video/mp4' } })
  };
  for (const name of ['onBeforeSendHeaders', 'onHeadersReceived', 'onCompleted', 'onErrorOccurred']) ses.webRequest[name] = fn => { listeners[name] = fn; };
  class BrowserWindow {
    constructor() {
      this.destroyed = false;
      this.webContents = { id: windows.length + 1, setWindowOpenHandler() {}, getTitle: () => this.url, mainFrame: { framesInSubtree: [] } };
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
    async loadURL(url) { this.url = url; }
  }
  const api = loadSource(resolverPath, (file, name) => {
    if (name === 'electron') return { BrowserWindow, session: { fromPartition: () => ses } };
    if (!realDomestic && file === resolverPath && name === './platforms') return { resolveDomestic: async () => null };
    if (file === resolverPath && ['./twitter', './youtube', './meta'].includes(name)) return {};
  }, { Date: class extends Date { static now() { return now; } }, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)) });
  function media(webContentsId, url) {
    const id = ++nextRequest;
    listeners.onBeforeSendHeaders?.({ id, webContentsId, url, requestHeaders: {} }, () => {});
    listeners.onHeadersReceived?.({ id, webContentsId, url, responseHeaders: { 'content-type': ['video/mp4'] } }, () => {});
    listeners.onCompleted?.({ id, webContentsId });
  }
  const advance = async () => { now += 10000; await new Promise(resolve => setTimeout(resolve, 20)); };
  const discover = (source, proxy, signal, session) => {
    const controller = new AbortController(); controllers.push(controller);
    const pending = api.discover(source, proxy, AbortSignal.any([signal, controller.signal]), session);
    void pending.catch(() => {});
    return pending;
  };
  return { ...api, discover, ses, windows, listeners, media, advance, cleanup: () => controllers.forEach(controller => controller.abort()) };
}

async function until(check) {
  for (let n = 0; n < 100; n++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
  assert.fail('Expected async state did not arrive');
}

test('shared login session ignores media from the visible site window', async t => {
  const h = browserHarness();
  t.after(h.cleanup);
  const pending = h.discover('https://site.test/A', '', new AbortController().signal, h.ses);
  await until(() => h.windows[0]?.url);
  h.media(777, 'https://cdn.test/B.mp4');
  h.media(h.windows[0].webContents.id, 'https://cdn.test/A.mp4');
  await h.advance(); await h.advance();
  const result = await pending;
  assert.equal(result.length, 1);
  assert.equal(result[0].url, 'https://cdn.test/A.mp4');
});

test('same-session discovery waits, cancelled waiter cannot release the active owner', async t => {
  const h = browserHarness();
  t.after(h.cleanup);
  const firstAbort = new AbortController(), waiterAbort = new AbortController();
  const first = h.discover('https://site.test/A', '', firstAbort.signal, h.ses);
  await until(() => h.windows[0]?.url);
  const firstListeners = { ...h.listeners };
  const waiting = h.discover('https://site.test/cancelled', '', waiterAbort.signal, h.ses);
  const waitingRejected = assert.rejects(waiting);
  waiterAbort.abort(); await waitingRejected;
  const second = h.discover('https://site.test/B', '', new AbortController().signal, h.ses);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.windows.length, 1, 'queued calls must not create a competing browser');
  assert.equal(h.listeners.onHeadersReceived, firstListeners.onHeadersReceived);
  const firstRejected = assert.rejects(first);
  firstAbort.abort(); await firstRejected;
  await until(() => h.windows.length === 2 && h.windows[1].url);
  h.media(h.windows[1].webContents.id, 'https://cdn.test/B.mp4');
  await h.advance(); await h.advance();
  assert.equal((await second)[0].url, 'https://cdn.test/B.mp4');
});

test('direct media discovery does not clear listeners it did not install', async () => {
  const h = browserHarness(); const external = () => {};
  h.ses.webRequest.onHeadersReceived(external);
  const result = await h.discover('https://cdn.test/direct.mp4', '', new AbortController().signal, h.ses);
  assert.equal(result.length, 1);
  assert.equal(h.listeners.onHeadersReceived, external);
});

test('invalid Bilibili P is terminal and cannot fall back to generic browser capture', async t => {
  const h = browserHarness(true); t.after(h.cleanup);
  await assert.rejects(h.discover('https://www.bilibili.com/video/BV17x411w7KC/?p=0', '', new AbortController().signal, h.ses), error => error.code === 'URL');
  assert.equal(h.windows.length, 0);
});

test('unsupported segmented Bilibili response cannot fall back to downloading one segment', async t => {
  const h = browserHarness(true); t.after(h.cleanup);
  h.ses.fetch = async url => url.includes('/view?')
    ? Response.json({ code: 0, data: { title: 'Segmented', cid: 100 } })
    : Response.json({ code: 0, data: { durl: [{ url: 'https://cdn.test/first.mp4' }, { url: 'https://cdn.test/second.mp4' }] } });
  await assert.rejects(h.discover('https://www.bilibili.com/video/BV17x411w7KC/', '', new AbortController().signal, h.ses), error => error.code === 'UNSUPPORTED');
  assert.equal(h.windows.length, 0);
});

function platformHarness(fetchAt) {
  const ses = { setProxy: async () => {}, setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, clearStorageData: async () => {}, closeAllConnections: async () => {} };
  return loadSource(platformsPath, (file, name) => {
    if (name === 'electron') return { session: { fromPartition: () => ses } };
    if (file === platformsPath && name === './resolver') return {
      proxyConfig: () => ({}), fetchAt: (_ses, url) => fetchAt(url),
      readLimited: async response => {
        const reader = response.body.getReader(), chunks = [];
        for (;;) { const part = await reader.read(); if (part.done) break; chunks.push(part.value); }
        return Buffer.concat(chunks).toString('utf8');
      }
    };
  });
}

for (const source of ['https://www.bilibili.com/video/BV17x411w7KC/?p=2', 'https://b23.tv/short']) {
  test(`Bilibili selects requested P from final URL: ${source}`, async () => {
    let playUrl;
    const api = platformHarness(async url => {
      if (url.includes('b23.tv')) { const response = new Response('redirected'); Object.defineProperty(response, 'url', { value: 'https://www.bilibili.com/video/BV17x411w7KC/?p=2' }); return response; }
      if (url.includes('/view?')) return Response.json({ code: 0, data: { title: 'Series', cid: 100, pages: [{ page: 1, cid: 100 }, { page: 2, cid: 200 }] } });
      playUrl = url; return Response.json({ code: 0, data: { durl: [{ url: 'https://cdn.test/part2.mp4' }] } });
    });
    const result = await api.resolveDomestic(source, '', new AbortController().signal);
    assert.equal(new URL(playUrl).searchParams.get('cid'), '200');
    assert.equal(result[0].source, source);
  });
}

test('Bilibili rejects absent/invalid P instead of requesting the first part', async () => {
  for (const p of ['9', '0', '-1', '1.5', 'no']) {
    let played = false;
    const api = platformHarness(async url => {
      if (url.includes('/view?')) return Response.json({ code: 0, data: { title: 'Series', cid: 100, pages: [{ page: 1, cid: 100 }] } });
      played = true; return Response.json({ code: 0, data: { durl: [{ url: 'https://cdn.test/part1.mp4' }] } });
    });
    await assert.rejects(api.resolveDomestic(`https://www.bilibili.com/video/BV17x411w7KC/?p=${p}`, '', new AbortController().signal));
    assert.equal(played, false);
  }
});

test('Bilibili without P retains the ordinary single-video API path', async () => {
  let playUrl;
  const api = platformHarness(async url => {
    if (url.includes('/view?')) return Response.json({ code: 0, data: { title: 'Single', cid: 100 } });
    playUrl = url; return Response.json({ code: 0, data: { durl: [{ url: 'https://cdn.test/single.mp4' }] } });
  });
  const result = await api.resolveDomestic('https://www.bilibili.com/video/BV17x411w7KC/', '', new AbortController().signal);
  assert.equal(new URL(playUrl).searchParams.get('cid'), '100');
  assert.equal(result[0].url, 'https://cdn.test/single.mp4');
});

test('Douyin retains usable landing HTML when API JSON contains no playable video', async () => {
  const html = '<script>window._SSR_HYDRATED_DATA = ' + JSON.stringify({ aweme_detail: { desc: 'Target', video: { play_addr: { url_list: ['https://cdn.test/target.mp4'] } } } }) + '</script>';
  const api = platformHarness(async url => url.includes('/web/api/') ? Response.json({ status_code: 0, item_list: [] }) : new Response(html));
  const result = await api.resolveDomestic('https://www.douyin.com/video/7123456789012345678', '', new AbortController().signal);
  assert.equal(result[0].url, 'https://cdn.test/target.mp4');
});
