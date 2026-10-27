import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { extractMediaUrl } from '../src/core/utils';
import {
  isBilibiliUrl,
  parseBilibiliId,
  buildBilibiliViewUrl,
  buildBilibiliPlayUrl,
  parseBilibiliResponse,
  BILIBILI_CONTEXT
} from '../src/core/platforms/bilibili';
import {
  isDouyinUrl,
  parseDouyinId,
  buildDouyinApiUrl,
  parseDouyinResponse,
  parseDouyinHtml,
  DOUYIN_CONTEXT
} from '../src/core/platforms/douyin';
import {
  isKuaishouUrl,
  parseKuaishouId,
  parseKuaishouHtml,
  KUAISHOU_CONTEXT
} from '../src/core/platforms/kuaishou';
import {
  isWeiboUrl,
  parseWeiboId,
  buildWeiboApiUrl,
  parseWeiboResponse,
  WEIBO_CONTEXT
} from '../src/core/platforms/weibo';
import {
  isXhsUrl,
  parseXhsId,
  parseXhsHtml,
  XHS_CONTEXT
} from '../src/core/platforms/xhs';
import {
  isXiguaUrl,
  parseXiguaId,
  parseXiguaHtml,
  XIGUA_CONTEXT
} from '../src/core/platforms/xigua';
import { DownloadError } from '../src/core/net';
import { download } from '../src/core/engine';
import { probe, run } from '../src/core/media';
import type { Job } from '../src/shared';

test('extractMediaUrl cleans mobile share text and extracts valid URLs', () => {
  // 抖音分享口令
  assert.equal(
    extractMediaUrl('7.12 复制打开抖音，看看【xxx的作品】 https://v.douyin.com/iLLg7Wk/ 这个太好笑了'),
    'https://v.douyin.com/iLLg7Wk/'
  );
  // B站分享文案
  assert.equal(
    extractMediaUrl('【【独家】年度最燃混剪！4K画质】 https://www.bilibili.com/video/BV1xx411c7mD/?share_source=copy_web 复制此链接'),
    'https://www.bilibili.com/video/BV1xx411c7mD/?share_source=copy_web'
  );
  // 快手分享链接
  assert.equal(
    extractMediaUrl('快手发财日记 https://v.kuaishou.com/abcdef 点击查看！'),
    'https://v.kuaishou.com/abcdef'
  );
  // 纯 URL
  assert.equal(
    extractMediaUrl('https://m.weibo.cn/status/5012345678901234'),
    'https://m.weibo.cn/status/5012345678901234'
  );
  // 带末尾中文标点
  assert.equal(
    extractMediaUrl('分享小红书链接：http://xhslink.com/a/xyz123，快来看看！'),
    'http://xhslink.com/a/xyz123'
  );
  // 空字符与普通文本
  assert.equal(extractMediaUrl(''), '');
  assert.equal(extractMediaUrl('纯文本没有任何链接'), '纯文本没有任何链接');
});

test('bilibili platform identification and response parsing', () => {
  assert.equal(isBilibiliUrl('https://www.bilibili.com/video/BV1xx411c7mD'), true);
  assert.equal(isBilibiliUrl('https://b23.tv/av170001'), true);
  assert.equal(isBilibiliUrl('https://b23.tv/abc1234'), true);
  assert.equal(isBilibiliUrl('https://example.com/video/BV1xx411c7mD'), false);

  assert.deepEqual(parseBilibiliId('https://www.bilibili.com/video/BV1xx411c7mD'), { bvid: 'BV1xx411c7mD' });
  assert.deepEqual(parseBilibiliId('https://www.bilibili.com/video/av170001'), { aid: '170001' });

  assert.equal(buildBilibiliViewUrl({ bvid: 'BV1xx411c7mD' }), 'https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD');
  assert.ok(buildBilibiliPlayUrl({ bvid: 'BV1xx411c7mD' }, 123456).includes('cid=123456'));

  const mockView = {
    code: 0,
    data: {
      title: 'Bilibili 测试视频标题',
      cid: 998877
    }
  };
  const mockPlay = {
    code: 0,
    data: {
      quality: 64,
      durl: [
        { url: 'https://cn-bj1-c-01.bilivideo.com/upgcxcode/test.mp4', size: 102400 }
      ]
    }
  };

  const candidates = parseBilibiliResponse(mockView, mockPlay, 'https://www.bilibili.com/video/BV1xx411c7mD');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].title, 'Bilibili 测试视频标题');
  assert.equal(candidates[0].url, 'https://cn-bj1-c-01.bilivideo.com/upgcxcode/test.mp4');
  assert.equal(candidates[0].kind, 'mp4');
  assert.equal(candidates[0].quality, '720P 高清');
  assert.equal(candidates[0].context.origin, BILIBILI_CONTEXT.origin);
  assert.equal(candidates[0].context.headers.referer, 'https://www.bilibili.com/');
});

test('douyin platform identification, watermark removal and image rejection', () => {
  assert.equal(isDouyinUrl('https://www.douyin.com/video/7123456789012345678'), true);
  assert.equal(isDouyinUrl('https://v.douyin.com/iLLg7Wk/'), true);
  assert.equal(isDouyinUrl('https://www.iesdouyin.com/share/video/7123456789012345678/'), true);
  assert.equal(isDouyinUrl('https://example.com/video/7123456789012345678'), false);

  assert.equal(parseDouyinId('https://www.douyin.com/video/7123456789012345678'), '7123456789012345678');
  assert.equal(parseDouyinId('https://www.douyin.com/discover?modal_id=7123456789012345678'), '7123456789012345678');
  assert.equal(buildDouyinApiUrl('7123456789012345678').includes('item_ids=7123456789012345678'), true);

  // 正常视频解析（带水印替换为无水印）
  const mockVideoData = {
    item_list: [{
      desc: '超燃跑车剪辑',
      author: { nickname: '车神' },
      video: {
        ratio: '1080p',
        play_addr: {
          url_list: [
            'http://aweme.snssdk.com/aweme/v1/playwm/?video_id=v0200fg1000000000000'
          ]
        }
      }
    }]
  };

  const candidates = parseDouyinResponse(mockVideoData, 'https://v.douyin.com/iLLg7Wk/');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].title, '车神: 超燃跑车剪辑');
  // playwm 替换为 play，且转 https
  assert.equal(candidates[0].url, 'https://aweme.snssdk.com/aweme/v1/play/?video_id=v0200fg1000000000000');
  assert.equal(candidates[0].quality, '1080p 无水印原画');
  assert.equal(candidates[0].context.headers.referer, 'https://www.douyin.com/');

  // 纯图文笔记拒绝
  const mockNoteData = {
    item_list: [{
      desc: '我的穿搭分享',
      author: { nickname: '时尚达人' },
      images: [{ url_list: ['https://example.com/img1.jpg'] }]
    }]
  };
  assert.throws(
    () => parseDouyinResponse(mockNoteData, 'https://v.douyin.com/iLLg7Wk/'),
    (err: any) => err instanceof DownloadError && err.message.includes('图文')
  );
});

test('kuaishou platform identification and html state parsing', () => {
  assert.equal(isKuaishouUrl('https://v.kuaishou.com/abcdef'), true);
  assert.equal(isKuaishouUrl('https://www.kuaishou.com/short-video/3x99887766'), true);
  assert.equal(parseKuaishouId('https://www.kuaishou.com/short-video/3x99887766'), '3x99887766');

  const mockHtml = `
    <!DOCTYPE html>
    <html>
    <body>
    <script>window.INIT_RUN_DATA = {"photo":{"caption":"快手老铁日常","userName":"老铁666","mainMvUrls":[{"url":"https://txmov2.a.yximgs.com/upic/test.mp4"}]}};</script>
    </body>
    </html>
  `;
  const candidates = parseKuaishouHtml(mockHtml, 'https://v.kuaishou.com/abcdef');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].title, '老铁666: 快手老铁日常');
  assert.equal(candidates[0].url, 'https://txmov2.a.yximgs.com/upic/test.mp4');
  assert.equal(candidates[0].context.headers.referer, 'https://v.kuaishou.com/');

  // 测试快手最新真实移动端 INIT_STATE 深度结构
  const modernKsHtml = `
    <html><body>
    <script>window.INIT_STATE = {"nested":{"data":{"photo":{"caption":"#醋意摇","userName":"SNH48-蒋舒婷-","mainMvUrls":[{"url":"https://hwmov.a.yximgs.com/test_kuaishou.mp4"}]}}}};</script>
    </body></html>
  `;
  const modernCandidates = parseKuaishouHtml(modernKsHtml, 'https://www.kuaishou.com/short-video/3xsja7ayh5c68eu');
  assert.equal(modernCandidates.length, 1);
  assert.equal(modernCandidates[0].title, 'SNH48-蒋舒婷-: #醋意摇');
  assert.equal(modernCandidates[0].url, 'https://hwmov.a.yximgs.com/test_kuaishou.mp4');

  // 快手纯图集作品拒绝
  const atlasHtml = '<html><body><script>window.INIT_RUN_DATA={"photo":{"imageCount":5,"atlas":true}};</script></body></html>';
  assert.throws(
    () => parseKuaishouHtml(atlasHtml, 'https://v.kuaishou.com/abcdef'),
    (err: any) => err instanceof DownloadError && err.message.includes('图文')
  );
});

test('weibo platform identification, api url and parsing', () => {
  assert.equal(isWeiboUrl('https://weibo.com/detail/5012345678901234'), true);
  assert.equal(isWeiboUrl('https://m.weibo.cn/status/5012345678901234'), true);
  assert.equal(parseWeiboId('https://m.weibo.cn/status/5012345678901234'), '5012345678901234');
  assert.equal(buildWeiboApiUrl('5012345678901234'), 'https://m.weibo.cn/statuses/show?id=5012345678901234');

  const mockWeibo = {
    data: {
      text: '<a href="/n/test">@某某</a> 精彩纪录片发布！<br/>快来看',
      user: { screen_name: '纪录片君' },
      page_info: {
        type: 'video',
        media_info: {
          playback_list: [
            { play_info: { quality_desc: '1080P 超清', url: 'https://f.video.weibocdn.com/1080p.mp4', bitrate: 2000000 } },
            { play_info: { quality_desc: '720P 高清', url: 'https://f.video.weibocdn.com/720p.mp4', bitrate: 1000000 } }
          ],
          mp4_720p_mp4: 'https://f.video.weibocdn.com/720p.mp4'
        }
      }
    }
  };

  const candidates = parseWeiboResponse(mockWeibo, 'https://m.weibo.cn/status/5012345678901234');
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].title, '纪录片君: @某某 精彩纪录片发布！ 快来看');
  assert.equal(candidates[0].url, 'https://f.video.weibocdn.com/1080p.mp4');
  assert.equal(candidates[0].quality, '1080P 超清');
  assert.equal(candidates[1].url, 'https://f.video.weibocdn.com/720p.mp4');

  // 纯图文微博拒绝
  const mockTextWeibo = { data: { text: '普通图文微博', user: { screen_name: '用户' }, page_info: { type: 'article' } } };
  assert.throws(
    () => parseWeiboResponse(mockTextWeibo, 'https://m.weibo.cn/status/5012345678901234'),
    (err: any) => err instanceof DownloadError && err.message.includes('图文')
  );
});

test('xiaohongshu platform identification, parsing and image rejection', () => {
  assert.equal(isXhsUrl('http://xhslink.com/a/abcdef'), true);
  assert.equal(isXhsUrl('https://www.xiaohongshu.com/explore/641234560000000012345678'), true);
  assert.equal(parseXhsId('https://www.xiaohongshu.com/explore/641234560000000012345678'), '641234560000000012345678');

  // 视频笔记解析
  const videoState = {
    note: {
      firstNote: {
        type: 'video',
        title: '小红书露营Vlog',
        user: { nickname: '露营家' },
        video: {
          media: {
            stream: {
              h264: [
                { masterUrl: 'https://sns-video-bd.xhscdn.com/camp_720.mp4', videoBitrate: 1500 }
              ]
            }
          }
        }
      }
    }
  };
  const mockVideoHtml = `<html><body><script>window.__INITIAL_STATE__=${JSON.stringify(videoState)};</script></body></html>`;
  const candidates = parseXhsHtml(mockVideoHtml, 'https://www.xiaohongshu.com/explore/641234560000000012345678');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].title, '露营家: 小红书露营Vlog');
  assert.equal(candidates[0].url, 'https://sns-video-bd.xhscdn.com/camp_720.mp4');

  // 纯图文笔记拒绝
  const normalState = {
    note: {
      firstNote: {
        type: 'normal',
        title: '好物推荐',
        user: { nickname: '种草君' },
        imageList: [{ url: 'https://sns-img.xhscdn.com/1.jpg' }]
      }
    }
  };
  const mockNormalHtml = `<html><body><script>window.__INITIAL_STATE__=${JSON.stringify(normalState)};</script></body></html>`;
  assert.throws(
    () => parseXhsHtml(mockNormalHtml, 'https://www.xiaohongshu.com/explore/641234560000000012345678'),
    (err: any) => err instanceof DownloadError && err.message.includes('图文')
  );
});

test('xigua platform identification and ssr base64 video parsing', () => {
  assert.equal(isXiguaUrl('https://www.ixigua.com/7123456789012345678'), true);
  assert.equal(parseXiguaId('https://www.ixigua.com/7123456789012345678'), '7123456789012345678');

  const rawUrl = 'https://v3-xg.ixigua.com/video/mp4/test.mp4';
  const base64Url = Buffer.from(rawUrl).toString('base64');
  const ssrState = {
    anyVideo: {
      gidInformation: {
        packerData: {
          title: '西瓜高清科普',
          videoResource: {
            normal: {
              video_list: {
                video_1: { definition: '720p', main_url: base64Url }
              }
            }
          }
        }
      }
    }
  };
  const mockHtml = `<html><body><script id="SSR_HYDRATED_DATA">window._SSR_HYDRATED_DATA=${JSON.stringify(ssrState)};</script></body></html>`;
  const candidates = parseXiguaHtml(mockHtml, 'https://www.ixigua.com/7123456789012345678');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].title, '西瓜高清科普');
  assert.equal(candidates[0].url, rawUrl);
  assert.equal(candidates[0].quality, '720p');
  assert.equal(candidates[0].context.origin, XIGUA_CONTEXT.origin);
});

test('end-to-end download with domestic candidate passes probe validation', async () => {
  const root = path.join(process.cwd(), '.test-data', 'domestic-e2e-' + randomUUID());
  await mkdir(root, { recursive: true });

  const ffmpeg = path.join(process.cwd(), 'node_modules/ffmpeg-static/ffmpeg.exe');
  const ffprobe = path.join(process.cwd(), 'node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
  const fixture = path.join(root, 'fixture.mp4');

  // 生成一个标准的 1 秒 mp4 测试媒体
  await run(ffmpeg, [
    '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    fixture
  ], AbortSignal.timeout(30000));

  const { size } = await import('node:fs/promises').then(fs => fs.stat(fixture));
  const server = createServer((req, res) => {
    // 模拟 B站等平台的 Referer 防盗链校验
    if (req.headers.referer !== 'https://www.bilibili.com/') {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: Referer required');
      return;
    }

    const range = req.headers.range;
    if (range) {
      const match = range.match(/bytes=(\d+)-(\d+)?/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : size - 1;
        const stream = (require('node:fs') as typeof import('node:fs')).createReadStream(fixture, { start, end });
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': 'video/mp4'
        });
        stream.pipe(res);
        return;
      }
    }
    res.writeHead(200, { 'Content-Length': size, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' });
    (require('node:fs') as typeof import('node:fs')).createReadStream(fixture).pipe(res);
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  try {
    const job: Job = {
      id: randomUUID(),
      directory: root,
      concurrency: 4,
      proxy: '',
      mode: 'mp4',
      deep: true,
      ffmpeg,
      ffprobe,
      ytdlp: '',
      candidate: {
        id: randomUUID(),
        title: 'Domestic_Download_Test',
        source: 'https://www.bilibili.com/video/BV1test',
        kind: 'mp4',
        quality: '1080P 高清',
        url: `http://127.0.0.1:${port}/test.mp4`,
        context: {
          origin: 'https://www.bilibili.com',
          headers: {
            referer: 'https://www.bilibili.com/',
            'user-agent': 'StreamHarborTest'
          },
          cookies: []
        }
      }
    };

    const output = await download(job, AbortSignal.timeout(30000), () => {});
    assert.ok(output.endsWith('.mp4'));

    const info = await probe(ffprobe, output, AbortSignal.timeout(10000));
    assert.ok(Number(info.format.duration) >= 0.8);
    const vStream = info.streams.find((s: any) => s.codec_type === 'video');
    assert.ok(vStream);
    assert.equal(vStream.codec_name, 'h264');
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});
