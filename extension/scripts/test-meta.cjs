const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, '.meta-unit-'));
const results = [];
const check = (name, fn) => { fn(); results.push(name); };
try {
  const output = path.join(temp, 'meta.cjs');
  buildSync({ entryPoints: [path.join(root, 'src/core/meta-media.ts')], outfile: output, bundle: true, platform: 'node', format: 'cjs' });
  const m = require(output);
  const ig = 'https://www.instagram.com/reel/TestPost/';
  const fb = 'https://www.facebook.com/watch/?v=12345';
  const media = 'https://scontent.example.fbcdn.net/movie.mp4?token=abc&bytestart=0&byteend=999';
  const full = 'https://scontent.example.fbcdn.net/movie.mp4?token=abc';
  check('Instagram post/reel/tv/profile-path and Facebook Watch/reel/videos/share URL recognition', () => {
    for (const url of [ig, 'https://instagram.com/p/ABC/', 'https://www.instagram.com/author/reel/ABC/', 'https://instagram.com/tv/ABC/', fb, 'https://m.facebook.com/reel/12345/', 'https://facebook.com/author/videos/name/12345/', 'https://facebook.com/share/v/abc/', 'https://fb.watch/abc/', 'https://instagram.com/share/reel/abc/']) assert(m.isMetaVideoUrl(url), url);
    for (const url of ['https://instagram.com/author/', 'https://facebook.com/', 'https://facebook.com.evil.test/reel/12345', 'https://fakeinstagram.com/p/ABC/', 'file://instagram.com/p/ABC/', 'https://user:secret@instagram.com/p/ABC/']) assert(!m.isMetaVideoUrl(url), url);
    assert.equal(m.metaPostId('https://facebook.com/name/videos/title/12345/'), '12345');
  });
  check('Instagram video_versions, quality, CDN signature and full range normalization', () => {
    const c = m.extractMetaMedia({ data: { xig_polaris_media: { code: 'TestPost', video_versions: [{ url: media, height: 1080 }, { url: 'https://scontent.example.cdninstagram.com/sd.mp4', height: 720 }] } } }, ig, 'Reel Title').candidates;
    assert.equal(c.length, 2); assert.equal(c[0].url, full); assert.equal(c[0].quality, 'Instagram 1080p'); assert.equal(c[0].headers.Referer, ig); assert.equal(c[0].kind, 'mp4');
  });
  check('Instagram carousel contains multiple videos, skips unrelated post and image URLs', () => {
    const r = m.extractMetaMedia({ items: [{ code: 'TestPost', carousel_media: [{ code: 'Child1', video_versions: [{ url: media }] }, { image_versions2: { candidates: [{ url: 'https://scontent.example.fbcdn.net/image.jpg' }] } }, { code: 'Child2', video_url: 'https://scontent.example.fbcdn.net/second.mp4' }] }, { code: 'Different', video_url: 'https://scontent.example.fbcdn.net/wrong.mp4' }] }, ig);
    assert.equal(r.candidates.length, 2); assert(!r.candidates.some(c => c.url.includes('wrong')));
  });
  check('Facebook legacy SD/HD and videoDeliveryLegacyFields', () => {
    const r = m.extractMetaMedia({ video: { id: '12345', videoDeliveryLegacyFields: { browser_native_hd_url: media, playable_url: 'https://scontent.example.fbcdn.net/sd.mp4' } } }, fb);
    assert.equal(r.candidates.length, 2); assert.equal(r.candidates[0].quality, 'Facebook HD');
  });
  check('Facebook current progressive_urls and recommendation identity filtering', () => {
    const r = m.extractMetaMedia({ nodes: [{ __typename: 'Video', id: '12345', videoDeliveryResponseFragment: { videoDeliveryResponseResult: { progressive_urls: [{ progressive_url: media, metadata: { quality: 'HD' } }] } } }, { __typename: 'Video', id: '99999', playable_url: 'https://scontent.example.fbcdn.net/wrong.mp4' }] }, fb);
    assert.equal(r.candidates.length, 1); assert.equal(r.candidates[0].url, full);
  });
  check('Facebook old sd_src/hd_src and extensionless progressive CDN URLs', () => {
    assert.equal(m.extractMetaMedia({ hd_src: 'https://video.example.fbcdn.net/videoplayback?sig=abc' }, fb).candidates.length, 1);
  });
  check('DASH-only status, no arbitrary audio/video segment or thumbnail extraction', () => {
    const r = m.extractMetaMedia({ video_dash_manifest: '<MPD/>', video_url: 'https://scontent.example.fbcdn.net/fragment.m4s', url: media, image: media }, ig);
    assert.equal(r.candidates.length, 0); assert.equal(r.dashOnly, true);
    assert.equal(m.extractMetaMedia({ video_dash_manifest: '<MPD/>', video_versions: [{ url: media }] }, ig).dashOnly, false);
  });
  check('Reject non-CDN, executable, credential-bearing, MPD, image and invalid URLs', () => {
    for (const url of ['javascript:alert(1)', 'blob:https://facebook.com/x', 'https://evil.test/video.mp4', 'https://fbcdn.net.evil.test/video.mp4', 'https://user:secret@scontent.fbcdn.net/v.mp4', 'http://scontent.fbcdn.net/v.mp4', 'https://scontent.fbcdn.net/v.mpd', 'https://scontent.fbcdn.net/v.jpg']) assert.equal(m.metaMediaUrl(url), null, url);
  });
  check('XSSI prefix, newline Relay chunks, escaped JSON and URL deduplication', () => {
    const chunk = JSON.stringify({ video_url: media });
    const r = m.extractMetaText(`for (;;);${chunk}\n${chunk}`, ig); assert.equal(r.candidates.length, 1); assert.equal(r.candidates[0].url, full);
    assert.equal(m.extractMetaText(JSON.stringify({ video_url: media }).replaceAll('/', '\\/'), ig).candidates.length, 1);
  });
  check('Parse old sharedData and ServerJS JSON without eval; reject JavaScript payload', () => {
    assert.equal(m.extractMetaText(`window._sharedData = ${JSON.stringify({ video_url: media })};`, ig).candidates.length, 1);
    assert.equal(m.extractMetaText(`requireLazy([],function(){ServerJS.handleWithCustomApplyEach(${JSON.stringify({ sd_src: media })});});`, fb).candidates.length, 1);
    assert.equal(m.extractMetaText('window._sharedData = {video_url: alert(1)};', ig).candidates.length, 0);
  });
  check('Actual Instagram Relay media result stored as nested serialized JSON', () => {
    const data = { require: [['ScheduledServerJS', 'handle', null, [{ __bbox: { result: JSON.stringify({ data: { xig_polaris_media: { code: 'TestPost', video_versions: [{ url: media, height: 1080 }] } } }) } }]]] };
    assert.equal(m.extractMetaText(JSON.stringify(data), ig).candidates[0].url, full);
  });
  check('Bounded parsing and cycle/depth protection', () => {
    assert.equal(m.extractMetaText(' '.repeat(m.META_MAX_TEXT + 1), ig).candidates.length, 0);
    const cycle = { video_url: media }; cycle.self = cycle; assert.equal(m.extractMetaMedia(cycle, ig).candidates.length, 1);
  });
  check('OpenGraph metadata and structured document scripts', () => {
    const doc = { title: 'Meta sample', scripts: [{ textContent: JSON.stringify({ video_url: media }) }], querySelectorAll: () => [{ getAttribute: () => media }, { getAttribute: () => 'https://facebook.com/embed/12345' }] };
    assert.equal(m.discoverMetaDocument(doc, ig).candidates.length, 1);
    assert.equal(m.discoverMetaDocument(doc, 'https://other.test').candidates.length, 0);
  });
  fs.writeFileSync(path.join(root, 'meta-unit-validation.json'), JSON.stringify({ timestamp: new Date().toISOString(), results, boundary: 'Parser fixtures; not live platform acceptance.' }, null, 2));
  console.log(`${results.length} Meta parser checks passed`);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
