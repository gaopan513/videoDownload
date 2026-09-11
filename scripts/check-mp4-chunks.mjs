// Mirrors DownloadScheduling.mp4Chunks so the arithmetic can be checked on Windows,
// where no Swift toolchain exists. The Swift tests themselves still gate CI.
const mp4ChunkSize = 8 * 1024 * 1024, mp4MinSize = 16 * 1024 * 1024;
function mp4Chunks(totalLength, acceptsRanges) {
  totalLength = BigInt(totalLength);
  if (!acceptsRanges || totalLength < BigInt(mp4MinSize)) return null;
  const count = Number((totalLength + BigInt(mp4ChunkSize) - 1n) / BigInt(mp4ChunkSize));
  if (!(count > 1 && count <= 4096)) return null;
  return Array.from({ length: count }, (_, i) => {
    const offset = BigInt(i) * BigInt(mp4ChunkSize);
    const remaining = totalLength - offset;
    return { offset, length: remaining < BigInt(mp4ChunkSize) ? remaining : BigInt(mp4ChunkSize) };
  });
}
let failed = 0;
const assert = (c, m) => { if (!c) { console.error('FAIL', m); failed++; } };
assert(mp4Chunks(1024 ** 3, false) === null, 'no ranges -> single request');
assert(mp4Chunks(1024, true) === null, 'tiny -> single request');
assert(mp4Chunks(mp4MinSize - 1, true) === null, 'below min -> single request');
assert(mp4Chunks(0, true) === null, 'empty -> single request');
assert(mp4Chunks(mp4ChunkSize * 4097, true) === null, 'absurd count rejected');
const size = 100 * 1024 * 1024 + 12345;
const chunks = mp4Chunks(size, true);
assert(chunks && chunks.length > 1, 'expected chunks');
assert(chunks[0].offset === 0n, 'starts at 0');
for (let i = 0; i < chunks.length; i++) {
  assert(chunks[i].length > 0n && chunks[i].length <= BigInt(mp4ChunkSize), 'chunk size bounds ' + i);
  if (i > 0) assert(chunks[i - 1].offset + chunks[i - 1].length === chunks[i].offset, 'contiguous ' + i);
}
assert(chunks.at(-1).offset + chunks.at(-1).length === BigInt(size), 'covers exactly');
for (const n of [mp4MinSize, mp4ChunkSize * 2, mp4ChunkSize * 2 + 1, mp4ChunkSize * 3 - 1]) {
  const c = mp4Chunks(n, true);
  assert(c.at(-1).offset + c.at(-1).length === BigInt(n), 'coverage for ' + n);
}
console.log(failed ? 'CHUNK LOGIC: FAILED' : 'CHUNK LOGIC: OK (' + chunks.length + ' chunks for ' + size + ' bytes)');
process.exitCode = failed ? 1 : 0;
