/**
 * 纯前端工具函数库（复用并升级自 StreamHarbor Windows 端）
 */

export function extractMediaUrl(text: string): string {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  try {
    const u = new URL(trimmed);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return trimmed;
    }
  } catch {
    // 忽略非有效URL格式错误，继续正则提取
  }

  const match = trimmed.match(/https?:\/\/[^\s\u4e00-\u9fa5"'<>()[\]{}]+/i);
  if (!match) return trimmed;

  let url = match[0];
  url = url.replace(/[.,;!?，。！？]+$/, '');
  return url;
}

export function cleanTitle(text: string, maxLength = 100): string {
  if (!text || typeof text !== 'string') return 'video';
  const cleaned = text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, maxLength) || 'video';
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function formatSpeed(bytesPerSec: number): string {
  return formatBytes(bytesPerSec) + '/s';
}

export async function retry<T>(fn: () => Promise<T>, retries = 3, delay = 800): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < retries) {
        await new Promise(r => setTimeout(r, delay * Math.pow(1.5, i)));
      }
    }
  }
  throw lastError;
}

export async function pool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  let error: unknown;
  const workerCount = Math.min(concurrency, items.length);
  const workers: Promise<void>[] = [];

  for (let i = 0; i < workerCount; i++) {
    workers.push((async () => {
      while (cursor < items.length && !error) {
        const idx = cursor++;
        try {
          await fn(items[idx], idx);
        } catch (e) {
          error = e;
        }
      }
    })());
  }

  await Promise.all(workers);
  if (error) throw error;
}
