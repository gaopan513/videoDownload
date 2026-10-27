import { parseYoutubeId, isYoutubeUrl, normalizeYoutubeUrl } from '../src/core/youtube';

const cases: [string, string | null][] = [
  ['https://www.youtube.com/watch?v=EMdSr1OciVc&t=31s', 'EMdSr1OciVc'],
  ['https://youtu.be/EMdSr1OciVc?si=3Hftom99oxhFZbHf', 'EMdSr1OciVc'],
  ['https://youtube.com/shorts/EMdSr1OciVc', 'EMdSr1OciVc'],
  ['https://www.youtube.com/embed/EMdSr1OciVc', 'EMdSr1OciVc'],
  ['https://m.youtube.com/watch?v=EMdSr1OciVc&list=PLx&index=2', 'EMdSr1OciVc'],
  ['youtu.be/EMdSr1OciVc', 'EMdSr1OciVc'],
  ['https://www.youtube-nocookie.com/embed/EMdSr1OciVc', 'EMdSr1OciVc'],
  ['https://www.youtube.com/watch?v=EMdSr1OciVc', 'EMdSr1OciVc'],
  ['https://www.youtube.com/feed/trending', null],
  ['https://www.bilibili.com/video/BV1xx411c7mD', null],
  ['https://www.youtube.com/watch?v=short', null],          // 非 11 位
  ['https://youtu.be/', null],                              // 无 ID
  ['not a url', null],
];

let fail = 0;
for (const [raw, expectId] of cases) {
  const got = parseYoutubeId(raw);
  const ok = got === expectId;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  isYt=${isYoutubeUrl(raw)} id=${got ?? '(null)'}  <- ${raw}`);
}

// 规范化必须丢弃 t/si/list 并统一为 watch
const norm = normalizeYoutubeUrl('https://youtu.be/EMdSr1OciVc?si=abc&t=31s');
console.log('\nnormalize =>', norm);
if (norm !== 'https://www.youtube.com/watch?v=EMdSr1OciVc') { fail++; console.log('FAIL normalize'); }
else console.log('PASS normalize strips t/si');

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL URL EDGE CASES PASS');
process.exit(fail ? 1 : 0);
