const {chromium}=require('../../windows/node_modules/playwright'); const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'); let replayServer;const temp=await fs.mkdtemp(path.join(root,'.live-hls-'));let context;let report={version:'1.0.5',at:new Date().toISOString(),page:'https://juok3.top/play/2/PrNsaH7nTGHpM3/6?s=qq&e=1'};
 try{
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{executablePath:process.env.CHROME_TEST_EXE,headless:true,args:[`--load-extension=${path.join(root,'dist')}`,`--disable-extensions-except=${path.join(root,'dist')}`],acceptDownloads:true});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const extensionId=new URL(worker.url()).host;
 const cdp=await context.browser().newBrowserCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:path.join(temp,'downloads')});
 let candidate; let rpc;
 if(process.env.RECORDED_HLS==='1') {
   const probe=JSON.parse(await fs.readFile(path.join(root,'hls-site-probe.json'),'utf8')); const manifest=probe.manifests.find(m=>m.text.includes('#EXTINF'));
   replayServer=require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','application/vnd.apple.mpegurl');res.end(manifest.text);});await new Promise(r=>replayServer.listen(0,'127.0.0.1',r));
   candidate={id:'live-png',kind:'hls',title:probe.title,url:`http://127.0.0.1:${replayServer.address().port}/recorded.m3u8`,sourceUrl:report.page,capturedAt:Date.now()};
   report.manifestSource=manifest.url; report.validationSource='现场抓取清单本地重放；所有分片按原清单远程下载，未替换分片内容'; report.expectedSegments=manifest.text.split(/\r?\n/).filter(l=>l.startsWith('#EXTINF')).length;
   rpc=await context.newPage();await rpc.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
 } else {
   const page=await context.newPage(); report.network=[]; page.on('requestfailed',r=>{if(/m3u8|ruyijx/.test(r.url())) report.network.push({url:r.url(),error:r.failure()});}); page.on('response',r=>{if(/m3u8/.test(r.url())) report.network.push({url:r.url(),status:r.status()});});
   await page.goto(report.page,{waitUntil:'domcontentloaded',timeout:60000});
   for(let i=0;i<40;i++){candidate=await worker.evaluate(async url=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===url);const pool=(await chrome.storage.session.get('tabCandidates')).tabCandidates?.[tab?.id]||[];return pool.find(c=>c.kind==='hls');},report.page);if(candidate)break;await new Promise(r=>setTimeout(r,1000));}
   report.pageTitle=await page.title(); report.pageText=(await page.locator('body').innerText()).slice(0,1000); report.captured=await worker.evaluate(()=>chrome.storage.session.get('tabCandidates'));
   assert(candidate,'No HLS candidate discovered in actual extension browser: '+JSON.stringify({title:report.pageTitle,text:report.pageText,network:report.network,captured:report.captured}));
   rpc=await context.newPage();await rpc.goto(`chrome-extension://${extensionId}/src/popup/index.html`); await page.close();
 }
 report.candidate=candidate;
 const started=await rpc.evaluate(candidate=>chrome.runtime.sendMessage({type:'START_NATIVE_DOWNLOAD',candidate}),candidate);assert(!started.error,started.error);
 let task;for(let i=0;i<900;i++){
 task=await rpc.evaluate(async id=>(await chrome.runtime.sendMessage({type:'GET_NATIVE_DOWNLOADS'})).tasks[id],candidate.id);
 if(i%10===0)console.log(JSON.stringify({stage:task?.stage,percentage:task?.percentage,notice:task?.notice,error:task?.errorMessage}));
 if(task&&['completed','failed','cancelled'].includes(task.stage))break;await new Promise(r=>setTimeout(r,1000));}
 report.task=task;assert.equal(task?.stage,'completed',JSON.stringify(task));
 const item=await worker.evaluate(async id=>(await chrome.downloads.search({id}))[0],task.downloadId);const stat=await fs.stat(item.filename);assert.equal(stat.size,task.diagnostics.receivedBytes);assert(task.diagnostics.normalizedSegments>0);
 const ffprobe=path.resolve(root,'../windows/node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');const media=JSON.parse(require('node:child_process').execFileSync(ffprobe,['-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height','-of','json',item.filename],{encoding:'utf8'}));assert(media.streams.some(s=>s.codec_type==='video'));report.savedBytes=stat.size;report.media=media;report.boundary=process.env.RECORDED_HLS==='1'?'使用现场抓取的第6集清单重放，远程真实分片经扩展落盘和FFprobe；上游新清单404，未完成重新打开页面的一键下载验收或全片深度解码':'指定第6集真实整集经扩展HLS落盘和FFprobe；未做全片深度解码';console.log(JSON.stringify({savedBytes:stat.size,diagnostics:task.diagnostics,media},null,2));
 }catch(error){report.error=String(error);throw error;}finally{await fs.writeFile(path.join(root,'hls-png-live-validation.json'),JSON.stringify(report,null,2));if(context)await context.close();if(replayServer)await new Promise(r=>replayServer.close(r));assert(temp.startsWith(root+path.sep+'.live-hls-'));await fs.rm(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
