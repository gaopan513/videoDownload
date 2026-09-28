/**
 * 从可能包含中文、表情包、分享口令的文本中提取合法的 http/https 链接
 */
export function extractMediaUrl(text: string): string {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  
  // 如果本身就是合法的纯 URL
  try {
    const u = new URL(trimmed);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return trimmed;
    }
  } catch {}

  // 正则匹配 URL，注意排除尾部常见的标点和中文括号
  const match = trimmed.match(/https?:\/\/[^\s\u4e00-\u9fa5"'<>()[\]{}]+/i);
  if (!match) return trimmed;

  let url = match[0];
  // 去除末尾可能被误匹配的英文标点符号
  url = url.replace(/[.,;!?，。！？]+$/, '');
  return url;
}

/**
 * 清洗标题文本：反转义 HTML 实体、去除 HTML 标签、合并多余空白
 */
export function cleanTitle(text: string, maxLength = 100): string {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * 提取并解析网页中嵌入的 window 状态机 JSON 数据（自动处理 undefined）
 */
export function extractHtmlState(html: string, pattern: RegExp): any {
  const match = html.match(pattern);
  if (!match || !match[1]) return null;
  try {
    let raw = match[1].trim();
    if (raw.startsWith('%7B')) {
      try { raw = decodeURIComponent(raw); } catch {}
    }
    return JSON.parse(raw.replace(/:\s*undefined/g, ':null'));
  } catch {
    return null;
  }
}
