import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  isTwitterUrl,
  parseTweetId,
  calculateSyndicationToken,
  buildSyndicationUrl,
  buildFxTwitterUrl,
  parseSyndicationResponse,
  parseFxTwitterResponse,
} from '../src/core/twitter';
import { DownloadError } from '../src/core/net';
import { download } from '../src/core/engine';
import { probe, run } from '../src/core/media';
import type { Job } from '../src/shared';

test('isTwitterUrl and parseTweetId extract tweet IDs accurately', () => {
  assert.equal(parseTweetId('https://x.com/elonmusk/status/1782390123456789012'), '1782390123456789012');
  assert.equal(parseTweetId('https://twitter.com/user/status/123456789?s=20&t=abc'), '123456789');
  assert.equal(parseTweetId('https://mobile.twitter.com/i/status/9876543210'), '9876543210');
  assert.equal(parseTweetId('https://x.com/i/web/status/1122334455'), '1122334455');
  assert.equal(parseTweetId('https://fxtwitter.com/someone/status/5566778899'), '5566778899');
  assert.equal(parseTweetId('https://vxtwitter.com/someone/status/9988776655'), '9988776655');

  assert.equal(isTwitterUrl('https://x.com/user/status/123456'), true);
  assert.equal(isTwitterUrl('https://x.com/home'), false);
  assert.equal(isTwitterUrl('https://example.com/status/123456'), false);
  assert.equal(isTwitterUrl('not a url'), false);
});

test('calculateSyndicationToken generates deterministic signature', () => {
  const token = calculateSyndicationToken('1782390123456789012');
  assert.ok(typeof token === 'string' && token.length > 0);
  assert.equal(calculateSyndicationToken('1782390123456789012'), token);
  assert.ok(buildSyndicationUrl('1782390123456789012').includes('token='));
  assert.ok(buildFxTwitterUrl('1782390123456789012').includes('1782390123456789012'));
});

test('parseSyndicationResponse parses multi-bitrate video, sorts descending, and formats titles', () => {
  const mockData = {
    text: 'Check out this amazing launch video! https://t.co/abc123xyz',
    user: { name: 'Space Exploration', screen_name: 'spacex' },
    mediaDetails: [
      {
        type: 'video',
        video_info: {
          variants: [
            { bitrate: 256000, content_type: 'video/mp4', url: 'https://video.twimg.com/vid/avc1/480x270/low.mp4' },
            { bitrate: 2176000, content_type: 'video/mp4', url: 'https://video.twimg.com/vid/avc1/1280x720/high.mp4' },
            { bitrate: 832000, content_type: 'video/mp4', url: 'https://video.twimg.com/vid/avc1/640x360/med.mp4' },
            { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/pl/master.m3u8' }
          ]
        }
      }
    ]
  };

  const candidates = parseSyndicationResponse(mockData, 'https://x.com/spacex/status/1782390123456789012');
  assert.equal(candidates.length, 3);
  // 最高码率/分辨率排首位
  assert.equal(candidates[0].url, 'https://video.twimg.com/vid/avc1/1280x720/high.mp4');
  assert.equal(candidates[0].quality, '720p (2176 kbps)');
  assert.equal(candidates[1].url, 'https://video.twimg.com/vid/avc1/640x360/med.mp4');
  assert.equal(candidates[1].quality, '360p (832 kbps)');
  assert.equal(candidates[2].url, 'https://video.twimg.com/vid/avc1/480x270/low.mp4');
  assert.equal(candidates[2].quality, '270p (256 kbps)');

  assert.equal(candidates[0].kind, 'mp4');
  assert.match(candidates[0].title, /Space Exploration \(@spacex\): Check out this amazing launch video!/);
  assert.equal(candidates[0].context.origin, 'https://twitter.com');
  assert.equal(candidates[0].context.headers.referer, 'https://twitter.com/');
});

test('parseSyndicationResponse supports animated_gif and multiple videos', () => {
  const mockGif = {
    text: 'Funny meme',
    user: { name: 'MemeLord', screen_name: 'memes' },
    mediaDetails: [
      {
        type: 'animated_gif',
        video_info: {
          variants: [
            { bitrate: 0, content_type: 'video/mp4', url: 'https://video.twimg.com/tweet_video/test.mp4' }
          ]
        }
      }
    ]
  };
  const gifCandidates = parseSyndicationResponse(mockGif, 'https://x.com/memes/status/1');
  assert.equal(gifCandidates.length, 1);
  assert.equal(gifCandidates[0].quality, 'GIF 动图');
  assert.match(gifCandidates[0].title, /\(GIF\)$/);

  // 多媒体推文 (Carousel)
  const mockMulti = {
    text: 'Two clips',
    user: { name: 'Creator', screen_name: 'creator' },
    mediaDetails: [
      {
        type: 'video',
        video_info: { variants: [{ bitrate: 500000, content_type: 'video/mp4', url: 'https://video.twimg.com/vid1.mp4' }] }
      },
      {
        type: 'video',
        video_info: { variants: [{ bitrate: 500000, content_type: 'video/mp4', url: 'https://video.twimg.com/vid2.mp4' }] }
      }
    ]
  };
  const multiCandidates = parseSyndicationResponse(mockMulti, 'https://x.com/creator/status/2');
  assert.equal(multiCandidates.length, 2);
  assert.match(multiCandidates[0].title, /^\[1\/2\]/);
  assert.match(multiCandidates[1].title, /^\[2\/2\]/);
});

test('parseSyndicationResponse handles quoted tweets, tombstones and non-video tweets', () => {
  const quoted = {
    text: 'Retweeting with comment',
    user: { screen_name: 'commenter' },
    quoted_tweet: {
      text: 'Original video text',
      user: { name: 'Original', screen_name: 'origin' },
      mediaDetails: [
        {
          type: 'video',
          video_info: {
            variants: [{ bitrate: 1000000, content_type: 'video/mp4', url: 'https://video.twimg.com/quoted.mp4' }]
          }
        }
      ]
    }
  };
  const quotedCandidates = parseSyndicationResponse(quoted, 'https://x.com/commenter/status/3');
  assert.equal(quotedCandidates.length, 1);
  assert.equal(quotedCandidates[0].url, 'https://video.twimg.com/quoted.mp4');

  // 主推文含有普通图片，且引用了视频推文
  const photoWithQuotedVideo = {
    text: 'Check this out',
    user: { screen_name: 'poster' },
    mediaDetails: [{ type: 'photo', url: 'https://pbs.twimg.com/media/pic.jpg' }],
    quoted_tweet: {
      text: 'Quoted video text',
      user: { name: 'QuotedUser', screen_name: 'quoted_user' },
      mediaDetails: [
        {
          type: 'video',
          video_info: {
            variants: [{ bitrate: 800000, content_type: 'video/mp4', url: 'https://video.twimg.com/quoted_vid.mp4' }]
          }
        }
      ]
    }
  };
  const fromQuotedWithPhoto = parseSyndicationResponse(photoWithQuotedVideo, 'https://x.com/poster/status/33');
  assert.equal(fromQuotedWithPhoto.length, 1);
  assert.equal(fromQuotedWithPhoto[0].url, 'https://video.twimg.com/quoted_vid.mp4');

  // Tombstone (已删除推文)
  const tombstone = { tombstone: { text: { text: '此推文已被删除。' } } };
  assert.throws(
    () => parseSyndicationResponse(tombstone, 'https://x.com/a/status/4'),
    (err: any) => err instanceof DownloadError && err.code === 'DISCOVERY' && err.message.includes('已')
  );

  // 纯文本无视频
  const textOnly = { text: 'No video here', user: { screen_name: 'novideo' }, mediaDetails: [] };
  assert.throws(
    () => parseSyndicationResponse(textOnly, 'https://x.com/a/status/5'),
    (err: any) => err instanceof DownloadError && err.code === 'DISCOVERY'
  );
});

test('parseFxTwitterResponse parses fallback data correctly', () => {
  const mockFallback = {
    code: 200,
    tweet: {
      text: 'Fallback tweet text https://t.co/123',
      author: { name: 'Tester', screen_name: 'tester' },
      media: {
        videos: [
          { url: 'https://video.twimg.com/fb_vid.mp4', height: 720, type: 'video' }
        ]
      }
    }
  };
  const candidates = parseFxTwitterResponse(mockFallback, 'https://x.com/tester/status/6');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, 'https://video.twimg.com/fb_vid.mp4');
  assert.equal(candidates[0].quality, '720p');
  assert.match(candidates[0].title, /Tester \(@tester\): Fallback tweet text/);

  // 404 测试
  assert.throws(
    () => parseFxTwitterResponse({ code: 404 }, 'https://x.com/a/status/7'),
    (err: any) => err instanceof DownloadError && err.code === 'DISCOVERY' && err.message.includes('不存在')
  );
});

test('end-to-end download with twitter candidate passes validation', async () => {
  const root = path.resolve('.test-data/tw-' + randomUUID());
  await mkdir(root, { recursive: true });
  const sample = path.join(root, 'tw-sample.mp4');
  const ffmpeg = path.resolve('node_modules/ffmpeg-static/ffmpeg.exe');
  const ffprobe = path.resolve('node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
  const signal = AbortSignal.timeout(30000);
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=12', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sample], signal);
  const sampleData = await readFile(sample);

  const server = createServer((req, res) => {
    const range = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
    if (range) {
      const start = +range[1], end = Math.min(+range[2], sampleData.length - 1);
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${sampleData.length}`, 'Content-Length': end - start + 1, 'Content-Type': 'video/mp4' });
      res.end(sampleData.subarray(start, end + 1));
    } else {
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', sampleData.length);
      res.end(sampleData);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  const mockUrl = `http://127.0.0.1:${port}/vid/avc1/1280x720/test.mp4`;

  try {
    const mockTweet = {
      text: 'Amazing tweet video test',
      user: { name: 'Twitter Author', screen_name: 'tw_author' },
      mediaDetails: [
        {
          type: 'video',
          video_info: {
            variants: [
              { bitrate: 2176000, content_type: 'video/mp4', url: mockUrl }
            ]
          }
        }
      ]
    };

    const candidates = parseSyndicationResponse(mockTweet, 'https://x.com/tw_author/status/99999999');
    assert.equal(candidates.length, 1);
    const chosen = candidates[0];

    const job: Job = {
      id: randomUUID(),
      directory: root,
      concurrency: 2,
      proxy: '',
      mode: 'mp4',
      deep: false,
      ffmpeg,
      ffprobe,
      ytdlp: '',
      candidate: chosen
    };

    const outPath = await download(job, signal, () => {});
    assert.ok(outPath.endsWith('.mp4'));
    const meta = await probe(ffprobe, outPath, signal);
    assert.ok(Number(meta.format.duration) >= 1.8);
    const vStream = meta.streams.find((s: any) => s.codec_type === 'video');
    assert.ok(vStream);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
