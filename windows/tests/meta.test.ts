import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopMetaCandidates, extractMetaHtml, extractMetaText, isMetaVideoUrl, metaPlatform } from '../src/core/meta';
import { requestHeaders } from '../src/core/net';

const ig = 'https://www.instagram.com/reel/ExampleCode/';
const fb = 'https://www.facebook.com/watch/?v=12345';
const media = 'https://video.xx.fbcdn.net/clip.mp4?token=signed&bytestart=10&byteend=20';

test('Meta accepts post, reel, watch and share URLs but rejects lookalike hosts and feeds', () => {
  for (const url of [ig, 'https://www.instagram.com/p/ExampleCode/', fb, 'https://www.facebook.com/user/videos/12345/', 'https://www.facebook.com/reel/12345', 'https://fb.watch/short/', 'https://www.facebook.com/share/v/short/']) assert.ok(isMetaVideoUrl(url));
  for (const url of ['https://www.instagram.com/', 'https://www.facebook.com/', 'https://facebook.com.evil.test/watch/?v=12345', 'https://u:p@facebook.com/watch/?v=12345', 'bad']) assert.equal(isMetaVideoUrl(url), false);
  assert.equal(metaPlatform(ig), 'Instagram');
});

test('Instagram embedded Relay JSON keeps target carousel, quality, title and complete signed URL', () => {
  const payload = { result: JSON.stringify({ items: [{ code: 'ExampleCode', caption: { text: '两段视频' }, carousel_media: [{ code: 'Child', video_versions: [{ height: 720, url: media }, { height: 720, url: media }] }] }, { code: 'Other', video_versions: [{ url: 'https://cdninstagram.com/other.mp4' }] }] }) };
  const parsed = extractMetaText(JSON.stringify(payload), ig);
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].url, 'https://video.xx.fbcdn.net/clip.mp4?token=signed');
  assert.equal(parsed.candidates[0].quality, 'Instagram 720p');
  assert.equal(parsed.candidates[0].title, '两段视频');
});

test('Facebook legacy and delivery fields exclude recommended videos and preserve multiple qualities', () => {
  const parsed = extractMetaText(JSON.stringify({ videos: [{ id: '999', hd_src: 'https://fbcdn.net/recommended.mp4' }, { id: '12345', title: '目标', videoDeliveryLegacyFields: { browser_native_hd_url: media, browser_native_sd_url: 'https://fbcdn.net/sd.mp4' }, videoDeliveryResponseFragment: { progressive_urls: [{ progressive_url: 'https://fbcdn.net/1080.mp4', metadata: { quality: '1080p' } }] } }] }), fb);
  assert.equal(parsed.candidates.length, 3);
  assert.ok(parsed.candidates.every(c => !c.url.includes('recommended')));
  assert.deepEqual(parsed.candidates.map(c => c.quality), ['Facebook HD', 'Facebook SD', 'Facebook 1080p']);
});

test('Meta HTML parses scripts, OpenGraph and XSSI lines without executing site JavaScript', () => {
  const html = `<title>测试 &amp; 视频</title><script type="application/json">${JSON.stringify({ code: 'ExampleCode', video_url: media })}</script><meta property="og:video" content="https://cdninstagram.com/og.mp4"><script>throw new Error('must not execute')</script>`;
  assert.equal(extractMetaHtml(html, ig).candidates.length, 2);
  const lines = 'for (;;);' + JSON.stringify({ id: '12345', playable_url: media }) + '\n' + JSON.stringify({ id: '999', playable_url: 'https://fbcdn.net/other.mp4' });
  assert.equal(extractMetaText(lines, fb).candidates.length, 1);
});

test('Meta rejects image, manifest, credentials and arbitrary CDN fields; distinguishes DASH-only', () => {
  for (const url of ['https://fbcdn.net/a.mpd', 'https://fbcdn.net/a.m4s', 'https://fbcdn.net/a.jpg', 'http://fbcdn.net/a.mp4', 'https://evil.test/a.mp4', 'https://u:p@fbcdn.net/a.mp4']) assert.equal(extractMetaText(JSON.stringify({ video_url: url }), ig).candidates.length, 0);
  assert.equal(extractMetaText(JSON.stringify({ url: media }), ig).candidates.length, 0);
  assert.equal(extractMetaText(JSON.stringify({ video_dash_manifest: '<MPD />' }), ig).dashOnly, true);
  assert.equal(extractMetaText(JSON.stringify({ video_dash_manifest: '<MPD />', video_url: media }), ig).dashOnly, false);
});

test('Desktop candidate conversion preserves source, private context and scoped cookies', () => {
  const parsed = extractMetaText(JSON.stringify({ video_url: media }), ig);
  const candidates = desktopMetaCandidates(parsed, ig, { origin: ig, headers: { 'user-agent': 'Desktop UA' }, cookies: [{ name: 'sessionid', value: 'secret', domain: '.instagram.com', path: '/', secure: true }] });
  assert.equal(candidates[0].kind, 'mp4');
  assert.equal(candidates[0].source, ig);
  assert.equal(candidates[0].context.origin, candidates[0].url);
  const headers = requestHeaders(candidates[0].url, candidates[0].context);
  assert.equal(headers.referer, ig);
  assert.equal(headers['user-agent'], 'Desktop UA');
  assert.equal(headers.cookie, undefined);
});

test('Desktop HTML enforces a global 100-candidate limit across scripts', () => {
  const scripts = Array.from({ length: 110 }, (_, i) => `<script>${JSON.stringify({ video_url: `https://cdninstagram.com/${i}.mp4` })}</script>`).join('');
  assert.equal(extractMetaHtml(scripts, ig).candidates.length, 100);
});
