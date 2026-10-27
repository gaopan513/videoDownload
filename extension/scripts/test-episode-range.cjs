const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, '.range-unit-'));
try {
  const output = path.join(temp, 'range.cjs');
  buildSync({ entryPoints: [path.join(root, 'src/core/episode-range.ts')], outfile: output, bundle: true, platform: 'node', format: 'cjs' });
  const { buildEpisodeRange: build } = require(output);
  const lib = build('https://www.libvio.io/w/714893650-3-1.html', 'https://www.libvio.io/w/714893650-3-12.html');
  assert.equal(lib.episodes.length, 12); assert.equal(lib.episodes[8].url, 'https://www.libvio.io/w/714893650-3-9.html');
  const green = build('https://www.lvsc168.com/play/93518-0-0.html', 'https://www.lvsc168.com/play/93518-0-127.html');
  assert.equal(green.episodes.length, 128); assert.equal(green.episodes[1].url, 'https://www.lvsc168.com/play/93518-0-1.html');
  assert.equal(build('https://example.test/watch?id=123&episode=1&line=3', 'https://example.test/watch?id=123&episode=3&line=3').episodes[1].url, 'https://example.test/watch?id=123&episode=2&line=3');
  assert.equal(build('https://example.test/e01.html', 'https://example.test/e12.html').episodes[1].url, 'https://example.test/e02.html');
  assert.equal(build('https://example.test/e9.html', 'https://example.test/e11.html').episodes[1].url, 'https://example.test/e10.html');
  assert.equal(build('https://example.test/e1.html', 'https://example.test/e1.html').episodes.length, 1);
  assert.equal(build('https://example.test/%E7%AC%AC1.html?q=%20', 'https://example.test/%E7%AC%AC3.html?q=%20').episodes[1].url, 'https://example.test/%E7%AC%AC2.html?q=%20');
  const invalid = [
    ['https://example.test/w/1-3-1.html', 'https://example.test/w/2-3-12.html'],
    ['https://example.test/w/1-3-1.html', 'https://example.test/w/1-4-12.html'],
    ['https://example.test/e1.html', 'https://other.test/e2.html'],
    ['https://example.test/e1.html', 'https://example.test/watch2.html'],
    ['https://example.test/e4.html', 'https://example.test/e2.html'],
    ['https://example.test/e0.html', 'https://example.test/e2000.html'],
    ['https://example.test/e9007199254740992.html', 'https://example.test/e9007199254740993.html'],
    ['https://example.test/e1.m3u8', 'https://example.test/e2.m3u8'],
    ['https://example.test/e1.mp4', 'https://example.test/e2.mp4'],
    ['https://example.test/e001.html', 'https://example.test/e03.html'],
    ['https://user:password@example.test/e1.html', 'https://user:password@example.test/e2.html'],
    ['file:///e1.html', 'file:///e2.html']
  ];
  for (const [first, last] of invalid) assert.throws(() => build(first, last));
  assert.equal(build('https://example.test/e1.html', 'https://example.test/e2000.html').episodes.length, 2000);
  console.log('20 range checks passed: URL templates, numbering, query parameters, percent escapes, unsafe/ambiguous range rejection');
} finally {
  assert(temp.startsWith(root + path.sep + '.range-unit-'));
  fs.rmSync(temp, { recursive: true, force: true });
}
