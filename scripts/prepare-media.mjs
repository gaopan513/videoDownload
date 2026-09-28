import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
const lock = JSON.parse(await readFile(new URL('../media-lock.json', import.meta.url), 'utf8'));
for (const entry of lock) {
  const digest = b => createHash('sha256').update(b).digest('hex');
  try { if (digest(await readFile(entry.path)) === entry.sha256) { console.log(entry.name + ' verified'); continue; } } catch {}
  const response = await fetch(entry.url); if (!response.ok) throw new Error(`Media download HTTP ${response.status}`);
  const binary = gunzipSync(Buffer.from(await response.arrayBuffer()));
  if (digest(binary) !== entry.sha256) throw new Error('Media SHA256 mismatch');
  await mkdir(path.dirname(entry.path), { recursive: true }); await writeFile(entry.path, binary); console.log(entry.name + ' installed and verified');
}
