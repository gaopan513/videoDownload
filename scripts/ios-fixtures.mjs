import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createCipheriv, createHash } from 'node:crypto';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
const out = path.resolve('mobile/ios/Tests/Fixtures');
mkdirSync(out,{recursive:true});
const run = args => { const result = spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y',...args],{stdio:'inherit'}); if(result.error) throw result.error; if(result.status !== 0) throw new Error('Fixture generation failed'); };
run(['-f','lavfi','-i','testsrc2=size=128x72:rate=12','-t','2','-an','-c:v','libx264','-pix_fmt','yuv420p','-f','mpegts',path.join(out,'video.ts')]);
run(['-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','2','-vn','-c:a','aac',path.join(out,'audio.aac')]);
run(['-f','lavfi','-i','testsrc2=size=128x72:rate=12','-t','1','-c:v','mpeg4',path.join(out,'unsupported.mp4')]);
const cipher = createCipheriv('aes-128-cbc',Buffer.alloc(16,7),Buffer.alloc(16,3));
writeFileSync(path.join(out,'encrypted.bin'),Buffer.concat([cipher.update('StreamHarbor AES test'),cipher.final()]));
const matrix = [
  ['h264-aac.mp4','libx264','aac',[]],
  ['hevc-ac3.mp4','libx265','ac3',['-tag:v','hvc1','-x265-params','log-level=error']],
  ['av1-eac3.mp4','libaom-av1','eac3',['-cpu-used','8','-crf','45']],
  ['mpeg4-mp3.mp4','mpeg4','libmp3lame',[]],
  ['h264-alac.mp4','libx264','alac',[]],
  ['vp9-opus.mkv','libvpx-vp9','libopus',['-deadline','realtime','-cpu-used','8']]
];
for (const [name,video,audio,options] of matrix) run(['-f','lavfi','-i','testsrc2=size=128x72:rate=12','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v',video,'-pix_fmt','yuv420p','-c:a',audio,...options,path.join(out,name)]);
const files = ['video.ts','audio.aac','unsupported.mp4','encrypted.bin',...matrix.map(row=>row[0])];
writeFileSync(path.join(out,'sha256.json'),JSON.stringify(Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(path.join(out,f))).digest('hex')])),null,2)+'\n');
console.log('Created synthetic iOS media fixtures. No third-party video content included.');
