// Some HLS CDNs prepend a complete PNG before the MPEG-TS payload.
// Strip only a structurally complete PNG, never scan arbitrary bytes for 0x47.
export function normalizeTsSegment(bytes: Uint8Array<ArrayBuffer>) {
  let offset = 0;
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((value, index) => bytes[index] === value)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let cursor = 8; let ended = false;
    const limit = Math.min(bytes.length, 1024 * 1024);
    while (cursor + 12 <= limit) {
      const size = view.getUint32(cursor);
      const end = cursor + 12 + size;
      if (end > limit) break;
      const type = String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 8));
      if (cursor === 8 && (type !== 'IHDR' || size !== 13)) break;
      if (type === 'IEND') {
        if (size !== 0) break;
        offset = end; ended = true; break;
      }
      cursor = end;
    }
    if (!ended) throw new Error('HLS 分片的 PNG 封装不完整，已停止保存');
  }
  const length = bytes.length - offset;
  if (!length || length % 188 !== 0 || (offset && length < 188 * 3)) throw new Error('HLS 分片不是完整 MPEG-TS 数据，已停止保存');
  for (let index = offset; index < bytes.length; index += 188) {
    if (bytes[index] !== 0x47) throw new Error('HLS 分片的 MPEG-TS 数据损坏，已停止保存');
  }
  // Release the wrapper bytes too when retaining chunks for pause/resume.
  return { bytes: offset ? bytes.slice(offset) : bytes, removedPrefixBytes: offset };
}
