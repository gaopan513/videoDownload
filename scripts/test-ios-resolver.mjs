import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const swift = readFileSync(new URL('../mobile/ios/Native/Resolver.swift', import.meta.url), 'utf8');
const script = swift.split('static let script = #"""')[1].split('"""#')[0];
function fixture({ videos = [], resources = [], response, title = '', text = '' } = {}) {
  const messages = [], events = {};
  class XHR {
    open() {}
    addEventListener(name, callback) { this[name] = callback; }
    getResponseHeader() { return this.mime; }
  }
  const context = {
    URL, location: { href: 'https://player.test/embed' }, XMLHttpRequest: XHR,
    document: { title, body: { innerText: text }, querySelectorAll: () => videos, addEventListener: (name, fn) => { events[name] = fn; } },
    performance: { getEntriesByType: () => resources.map(name => ({ name })) },
    setInterval: fn => { events.tick = fn; }, addEventListener: (name, fn) => { events[name] = fn; },
    fetch: () => response ? Promise.resolve(response) : new Promise(() => {}),
    webkit: { messageHandlers: { harborMedia: { postMessage: message => { if (message.url) messages.push(message); else events.pageState = message; } } } }
  };
  context.window = context;
  vm.runInNewContext(script, context);
  return { context, messages, events };
}
test('captures HLS fetch before its response finishes', () => {
  const f = fixture(); f.context.fetch({ url: '/stream.m3u8?token=x' });
  assert.equal(f.messages[0].kind, 'hls');
});
test('captures XHR at open before load', () => {
  const f = fixture(); new f.context.XMLHttpRequest().open('GET', '/video.mp4');
  assert.equal(f.messages[0].url, 'https://player.test/video.mp4');
});
test('captures extensionless video for native content probing', () => {
  const f = fixture({ videos: [{ currentSrc: 'https://cdn.test/play?id=42' }] });
  f.events.tick(); assert.equal(f.messages[0].kind, 'unknown');
});
test('does not infer media from telemetry query strings', () => {
  const f = fixture({ resources: ['https://stats.test/log?url=a.mp4', 'https://cdn.test/a.m3u8?k=1'] });
  f.events.tick(); assert.equal(f.messages.length, 1); assert.equal(f.messages[0].kind, 'hls');
});
test('ignores blob, empty and javascript sources', () => {
  const f = fixture({ videos: [{ src: 'blob:https://player.test/id' }, { src: '' }, { src: 'javascript:void(0)' }] });
  f.events.tick(); assert.equal(f.messages.length, 0);
});
test('captures extensionless fetch by MIME', async () => {
  const f = fixture({ response: { url: 'https://cdn.test/stream', headers: { get: () => 'application/vnd.apple.mpegurl' } } });
  await f.context.fetch('/stream'); assert.equal(f.messages[0].kind, 'hls');
});
test('skips analytics and ad hostnames entirely', () => {
  const f = fixture({ resources: [
    'https://www.clarity.ms/tag/abc.mp4',
    'https://google-analytics.com/collect?v=1&m3u8',
    'https://ads.cnzz.com/t.png?file=/v.mp4',
    'https://cdn.test/real.m3u8',
  ] });
  f.events.tick();
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].url, 'https://cdn.test/real.m3u8');
});
test('skips ad and ornament media paths', () => {
  const f = fixture({ resources: [
    'https://cdn.test/banner/logo.mp4',
    'https://cdn.test/static/ad-stream.m3u8',
    'https://cdn.test/promo/intro.mp4',
    'https://cdn.test/movie/main.m3u8',
  ] });
  f.events.tick();
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].url, 'https://cdn.test/movie/main.m3u8');
});
test('tags player-driven captures with stronger origin than timeline scan', () => {
  const f = fixture({ videos: [{ currentSrc: 'https://cdn.test/main.m3u8' }], resources: ['https://cdn.test/main.m3u8'] });
  f.events.tick();
  // Same URL arrives twice: video origin (rank 2) must survive, resource never downgrades it.
  assert.equal(f.messages.filter(m => m.url === 'https://cdn.test/main.m3u8').length, 2);
  assert.equal(f.messages[0].origin, 'video');
  assert.equal(f.messages[1].origin, 'resource');
});
test('reports access verification and clears state once the player loads', () => {
  const f = fixture({title:'访问验证',text:'Cap 验证 点击以确认你是真人 点击完成验证'});
  f.events.tick(); assert.equal(f.events.pageState.verification,'true');
  assert.equal(f.messages.length,0);
  f.context.document.title = '视频播放'; f.context.document.body.innerText = '';
  f.events.tick(); assert.equal(f.events.pageState.verification,'false');
});
