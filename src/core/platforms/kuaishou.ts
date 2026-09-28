import { randomUUID } from 'node:crypto';
import { DownloadError } from '../net';
import { cleanTitle, extractHtmlState } from '../utils';
import type { Candidate, Context } from '../../shared';

export const KUAISHOU_CONTEXT: Context = {
  origin: 'https://www.kuaishou.com',
  headers: {
    referer: 'https://v.kuaishou.com/',
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
  },
  cookies: []
};

const KUAISHOU_HOST_PATTERN = /(?:^|\.)(?:kuaishou\.com|gifshow\.com|chenzhongtech\.com)$/i;

export function isKuaishouUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return KUAISHOU_HOST_PATTERN.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function parseKuaishouId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/(?:short-video|video|fw\/photo)\/([a-zA-Z0-9_-]+)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function parseKuaishouHtml(html: string, originalUrl: string): Candidate[] {
  if (!html || typeof html !== 'string') {
    throw new DownloadError('DISCOVERY', '快手页面数据为空');
  }

  // 1. 优先匹配现代移动端页面中的 window.INIT_STATE
  let photoData: any = null;
  const initState = extractHtmlState(html, /window\.INIT_STATE\s*=\s*({.+?});?<\/script>/s);
  if (initState) {
    const findPhotoInState = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.photo && (obj.photo.mainMvUrls || obj.photo.manifest || obj.photo.photoUrl)) {
        return obj.photo;
      }
      for (const k of Object.keys(obj)) {
        const found = findPhotoInState(obj[k]);
        if (found) return found;
      }
      return null;
    };
    photoData = findPhotoInState(initState);
  }

  // 2. 尝试匹配旧版 window.INIT_RUN_DATA / window.pageData
  if (!photoData) {
    const initParsed = extractHtmlState(html, /window\.INIT_RUN_DATA\s*=\s*({.+?});?<\/script>/s) ||
                       extractHtmlState(html, /window\.pageData\s*=\s*({.+?});?<\/script>/s);
    if (initParsed) {
      photoData = initParsed.photo || initParsed.currentWork || initParsed;
    }
  }

  // 3. 尝试匹配 window.__APOLLO_STATE__
  if (!photoData) {
    const apollo = extractHtmlState(html, /window\.__APOLLO_STATE__\s*=\s*({.+?});?<\/script>/s);
    if (apollo) {
      const defaultClient = apollo.defaultClient || apollo;
      for (const k of Object.keys(defaultClient)) {
        if (k.startsWith('VisionVideoDetail:') || k.startsWith('Photo:')) {
          photoData = defaultClient[k];
          break;
        }
      }
    }
  }

  // 4. 从 photoData 提取直链、标题和画质
  const extractVideo = (obj: any): { url: string; title: string; quality?: string } | null => {
    if (!obj || typeof obj !== 'object') return null;

    let url: string | undefined;
    let quality = '无水印原画';

    // 优先从 mainMvUrls 获取无水印 MP4 直链
    if (Array.isArray(obj.mainMvUrls) && obj.mainMvUrls.length > 0) {
      url = obj.mainMvUrls[0]?.url || obj.mainMvUrls[0];
    }

    // 其次从 manifest.adaptationSet 中获取高质量直链
    if (!url && Array.isArray(obj.manifest?.adaptationSet)) {
      for (const adapt of obj.manifest.adaptationSet) {
        if (Array.isArray(adapt.representation) && adapt.representation.length > 0) {
          const rep = adapt.representation[0];
          url = rep.url || rep.backupUrl?.[0];
          if (rep.qualityLabel) quality = rep.qualityLabel;
          if (url) break;
        }
      }
    }

    if (!url && typeof obj.srcNoMark === 'string') {
      url = obj.srcNoMark;
    } else if (!url && typeof obj.photoUrl === 'string' && /\.mp4/i.test(obj.photoUrl)) {
      url = obj.photoUrl;
    } else if (!url && typeof obj.playUrl === 'string') {
      url = obj.playUrl;
    }

    if (url && typeof url === 'string') {
      const caption = obj.caption || obj.title || obj.name || '快手视频';
      const user = obj.userName || obj.author?.name || '';
      const title = cleanTitle(user ? `${user}: ${caption}` : caption);
      return { url, title, quality };
    }

    for (const key of Object.keys(obj)) {
      const found = extractVideo(obj[key]);
      if (found) return found;
    }
    return null;
  };

  const video = photoData ? extractVideo(photoData) : null;
  if (!video) {
    // 检查是否为纯图集作品
    if (html.includes('"imageCount"') || html.includes('"atlas":') || html.includes('"singlePicture":true')) {
      throw new DownloadError('DISCOVERY', '该快手内容为图集(图文)，未包含视频');
    }
    throw new DownloadError('DISCOVERY', '未能从快手页面中提取到视频播放流');
  }

  return [{
    id: randomUUID(),
    title: video.title,
    url: video.url,
    source: originalUrl,
    kind: 'mp4',
    quality: video.quality || '原画',
    context: KUAISHOU_CONTEXT
  }];
}
