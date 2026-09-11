import UIKit
import WebKit

// One candidate's concurrent expansion outcome; keeps discovery order after
// the task group finishes (named struct instead of a Result tuple so the
// local syntax checker accepts the task-group payload type).
private struct Expansion {
    let index: Int
    let candidates: [MediaCandidate]
    let failure: String?
}

// Untrusted sites live in this separate WebView, never in the Capacitor bridge view.
@MainActor final class Resolver: NSObject, WKScriptMessageHandler, WKNavigationDelegate, UIAdaptivePresentationControllerDelegate {
    private var web: WKWebView?
    private var navigation: UINavigationController?
    private var continuation: CheckedContinuation<[MediaCandidate], Error>?
    private var timeout: Task<Void,Never>?
    private var discovered: [(url:URL, frame:URL, kind:String, origin:String)] = []
    private var inlineDiscovered: [(String,URL)] = []
    private var source: URL?
    private var finishing = false
    private var navigationErrors: [String] = []
    private var verificationPage = false
    // Keep verification state for retries in this resolver's lifetime, without
    // sharing Safari's cookies or persisting them across app launches.
    private let websiteDataStore = WKWebsiteDataStore.nonPersistent()
    private var userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"

    func resolve(_ url: URL, interactive: Bool, presenter: UIViewController) async throws -> [MediaCandidate] {
        guard continuation == nil else { throw HarborError.message("已有网页正在识别") }
        if ["mp4","m3u8"].contains(url.pathExtension.lowercased()) && !interactive {
            return try await Resolver.expand(url,context:WebContext(referer:url,userAgent:userAgent,cookies:[]),title:"视频",hint:url.pathExtension == "m3u8" ? "hls" : "mp4")
        }
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation; self.source = url; discovered = []; inlineDiscovered = []; finishing = false; navigationErrors = []; verificationPage = false
            let controller = WKUserContentController()
            controller.add(self,name:"harborMedia")
            controller.addUserScript(WKUserScript(source:Self.script,injectionTime:.atDocumentStart,forMainFrameOnly:false))
            let config = WKWebViewConfiguration()
            config.userContentController = controller; config.websiteDataStore = websiteDataStore
            config.allowsInlineMediaPlayback = true; config.mediaTypesRequiringUserActionForPlayback = []
            let web = WKWebView(frame:.zero,configuration:config)
            self.web = web; web.navigationDelegate = self
            let page = UIViewController(); page.view = web; page.title = "播放视频后完成识别"
            page.navigationItem.leftBarButtonItem = UIBarButtonItem(title:"取消",style:.plain,target:self,action:#selector(cancel))
            page.navigationItem.rightBarButtonItem = UIBarButtonItem(title:"完成识别",style:.done,target:self,action:#selector(done))
            let nav = UINavigationController(rootViewController:page); nav.modalPresentationStyle = .fullScreen
            navigation = nav; presenter.present(nav,animated:true); nav.presentationController?.delegate = self
            web.load(URLRequest(url:url))
            if !interactive {
                timeout = Task { [weak self] in
                    try? await Task.sleep(for:.seconds(25))
                    guard !Task.isCancelled else { return }
                    self?.done()
                }
            }
        }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard !finishing, let info = message.body as? [String:String] else { return }
        if info["event"] == "pageState", message.frameInfo.isMainFrame {
            verificationPage = info["verification"] == "true"
            if verificationPage { navigation?.topViewController?.navigationItem.prompt = "请先完成网页验证，再播放视频" }
            else { navigation?.topViewController?.navigationItem.prompt = nil }
            return
        }
        if info["event"] == "inlineHLS" {
            guard inlineDiscovered.count < 4, let text = info["playlist"], text.utf8.count <= 1024*1024,
                  text.hasPrefix("#EXTM3U"),
                  let frame = message.frameInfo.request.url.flatMap({ try? webURL($0.absoluteString) }) ?? source,
                  !inlineDiscovered.contains(where: { $0.0 == text && $0.1 == frame }) else { return }
            inlineDiscovered.append((text,frame)); return
        }
        guard discovered.count < 64,
              let raw = info["url"], raw.count <= 8192, let url = try? webURL(raw),
              let frame = message.frameInfo.request.url.flatMap({ try? webURL($0.absoluteString) }) ?? source else { return }
        let kind = info["kind"] ?? "unknown"
        let origin = info["origin"] ?? "resource"
        if let index = discovered.firstIndex(where: { $0.url == url }) {
            // Same URL seen again: keep the known kind, upgrade to a stronger origin
            // (video/request beat passive resource-timeline hits), never downgrade.
            if Resolver.originRank(origin) > Resolver.originRank(discovered[index].origin) { discovered[index].origin = origin }
            return
        }
        discovered.append((url:url, frame:frame, kind:kind, origin:origin))
    }
    // Player-driven evidence (a <video> element or a programmatic media request)
    // is far more meaningful than passive resource-timeline entries, which also
    // contain preloaded ad snippets.
    private nonisolated static func originRank(_ origin: String) -> Int {
        switch origin {
        case "video": return 2
        case "request": return 1
        default: return 0
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        // Empty/srcdoc frames bootstrap many embedded players before loading their media.
        if !((navigationAction.targetFrame?.isMainFrame) ?? true),
           ["about:blank", "about:srcdoc"].contains(url.absoluteString) { decisionHandler(.allow); return }
        guard (try? webURL(url.absoluteString)) != nil else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame == nil { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { record(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { record(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { navigationErrors.append("网页进程已终止，请重新识别") }
    private func record(_ error: Error) {
        let e = error as NSError
        guard e.code != NSURLErrorCancelled, navigationErrors.count < 4 else { return }
        navigationErrors.append("网页加载失败（\(e.domain) \(e.code)）")
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let mime = navigationResponse.response.mimeType ?? ""
        if let url = navigationResponse.response.url, let source, mime.contains("mpegurl") || mime == "video/mp4" {
            if let index = discovered.firstIndex(where: { $0.url == url }) {
                if Resolver.originRank("request") > Resolver.originRank(discovered[index].origin) { discovered[index].origin = "request" }
            }
            else if discovered.count < 64 { discovered.append((url:url, frame:source, kind:mime.contains("mpegurl") ? "hls" : "mp4", origin:"request")) }
        }
        decisionHandler(.allow)
    }
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { cancel() }
    @objc private func cancel() {
        guard !finishing else { return }
        finish(.failure(HarborError.message("已取消网页识别")))
    }
    @objc private func done() {
        guard !finishing, continuation != nil, let web else { return }
        // Do not tear down a challenge/slow player at the automatic deadline.
        // The user can complete verification and playback in this same session.
        if discovered.isEmpty && inlineDiscovered.isEmpty && navigationErrors.isEmpty {
            timeout?.cancel(); timeout = nil
            navigation?.topViewController?.navigationItem.prompt = verificationPage
                ? "请先完成网页验证，再播放视频并点击完成识别"
                : "尚未发现视频，请播放后再次点击完成识别"
            return
        }
        finishing = true; timeout?.cancel()
        navigation?.topViewController?.navigationItem.rightBarButtonItem?.isEnabled = false
        Task { @MainActor in
            let cookies = await web.configuration.websiteDataStore.httpCookieStore.harborCookies()
            let stored = cookies.map { WebCookie(name:$0.name,value:$0.value,domain:$0.domain,path:$0.path,secure:$0.isSecure,expires:$0.expiresDate) }
            let rawAgent = try? await web.evaluateJavaScript("navigator.userAgent")
            if let agentString = rawAgent as? String { userAgent = agentString }
            let title = String((web.title ?? "视频").prefix(160))
            var results: [MediaCandidate] = []
            var failures: [String] = []
            for (text,base) in inlineDiscovered {
                let context = WebContext(referer:base,userAgent:userAgent,cookies:stored)
                do {
                    let playlist = try HLS.parse(text,base:base)
                    results.append(contentsOf:Resolver.candidates(playlist,url:base,context:context,title:title,inlinePlaylist:text))
                } catch { failures.append((error as? HarborError)?.errorDescription ?? "内嵌播放列表无效") }
            }
            // Process only a bounded number of detections; the user can reopen the page for another player.
            // Expand candidates concurrently (4 at a time) so one slow host no longer
            // delays the others; results and failure notes keep discovery order.
            // Rank before spending round-trips: player-driven evidence first, then
            // collapse signed variants of one file (same path, different token).
            var detection = Array(discovered.prefix(12))
            detection = detection.enumerated().sorted { lhs, rhs in
                let lRank = Resolver.originRank(lhs.element.origin), rRank = Resolver.originRank(rhs.element.origin)
                if lRank != rRank { return lRank > rRank }
                return lhs.offset < rhs.offset
            }.map(\.element)
            var seenPaths = Set<String>()
            detection = detection.filter { hit in
                let key = hit.url.path
                guard !key.isEmpty else { return true }
                return seenPaths.insert(key).inserted
            }
            var expansions = [Expansion]()
            expansions.reserveCapacity(detection.count)
            await withTaskGroup(of: Expansion.self) { group in
                var next = 0
                func add() {
                    guard next < detection.count else { return }
                    let index = next
                    let hit = detection[next]
                    next += 1
                    group.addTask { [title, userAgent, stored] in
                        do { return Expansion(index:index,candidates:try await Resolver.expandDetected(hit.url,context:WebContext(referer:hit.frame,userAgent:userAgent,cookies:stored),title:title,hint:hit.kind),failure:nil) }
                        catch { return Expansion(index:index,candidates:[],failure:(error as? HarborError)?.errorDescription ?? "网络请求失败（\((error as NSError).code)）") }
                    }
                }
                for _ in 0..<min(4,detection.count) { add() }
                for await expansion in group {
                    expansions.append(expansion)
                    add()
                }
            }
            expansions.sort { $0.index < $1.index }
            for expansion in expansions {
                if expansion.candidates.isEmpty, let detail = expansion.failure { failures.append(detail) }
                results.append(contentsOf:expansion.candidates)
            }
            if results.isEmpty {
                let detail = (navigationErrors + Array(failures.prefix(3))).joined(separator:"；")
                finish(.failure(HarborError.message("识别失败：发现 \(discovered.count + inlineDiscovered.count) 个媒体地址。\(detail.isEmpty ? "请使用打开网页识别，播放视频后点击完成识别。" : detail)")))
            }
            else { finish(.success(Array(results.prefix(32)))) }
        }
    }
    private func finish(_ result: Result<[MediaCandidate],Error>) {
        timeout?.cancel(); timeout = nil
        web?.stopLoading(); web?.configuration.userContentController.removeScriptMessageHandler(forName:"harborMedia")
        navigation?.dismiss(animated:true); navigation = nil; web = nil; discovered = []; inlineDiscovered = []
        let saved = continuation; continuation = nil; finishing = false; saved?.resume(with:result)
    }
    // nonisolated: expansion is pure networking over its own HTTP session, so
    // candidate detection can run concurrently instead of one-by-one.
    private nonisolated static func expand(_ url: URL, context: WebContext, title: String, hint: String) async throws -> [MediaCandidate] {
        if hint == "unknown" {
            let probe = HTTP(context); defer { probe.close() }
            let kind = try await probe.mediaKind(url)
            probe.close()
            return try await expand(url,context:context,title:title,hint:kind)
        }
        if hint == "mp4" { return [MediaCandidate(title:title,url:url,audioURL:nil,kind:"mp4",quality:"源画质",context:context)] }
        let http = HTTP(context); defer { http.close() }
        let playlist = try await http.playlist(url)
        return candidates(playlist,url:url,context:context,title:title)
    }
    private nonisolated static func candidates(_ playlist: Playlist, url: URL, context: WebContext, title: String, inlinePlaylist: String? = nil) -> [MediaCandidate] {
        if playlist.variants.isEmpty { return [MediaCandidate(title:title,url:url,audioURL:nil,kind:"hls",quality:"源画质",context:context,inlinePlaylist:inlinePlaylist)] }
        return playlist.variants.prefix(16).flatMap { variant -> [MediaCandidate] in
            let tracks = playlist.audio.filter { $0.group == variant.audioGroup }
            if tracks.isEmpty { return [MediaCandidate(title:title,url:variant.url,audioURL:nil,kind:"hls",quality:variant.quality,context:context)] }
            return tracks.map { MediaCandidate(title:title,url:variant.url,audioURL:$0.url,kind:"hls",quality:variant.quality + " · " + $0.name,context:context) }
        }
    }
    static let script = #"""
    (() => {
      const inlineLists = new Set();
      const inlineHLS = text => {
        if (typeof text !== 'string' || text.length > 1024*1024 || inlineLists.size >= 4) return;
        text = text.trim();
        if (!text.startsWith('#EXTM3U') || inlineLists.has(text)) return;
        inlineLists.add(text);
        window.webkit.messageHandlers.harborMedia.postMessage({event:'inlineHLS',playlist:text});
      };
      const send = (raw, mime = '', media = false, origin = 'resource') => {
        try {
          if (!raw) return;
          // Native Safari players may receive a data: HLS source; MSE players
          // may fetch the same data URI before replacing video.src with a blob.
          if (typeof raw === 'string' && /^data:application\/(?:vnd\.apple\.mpegurl|x-mpegurl)[;,]/i.test(raw)) {
            if (raw.length > 1500000) return;
            const comma = raw.indexOf(',');
            if (comma < 0) return;
            inlineHLS(/;base64$/i.test(raw.slice(0,comma)) ? atob(raw.slice(comma+1)) : decodeURIComponent(raw.slice(comma+1)));
            return;
          }
          const u = new URL(raw, location.href);
          if (!/^https?:$/.test(u.protocol)) return;
          // Skip obvious non-content hosts (analytics/ads/telemetry): these often
          // appear as mp4/m3u8 URLs on tracker endpoints and pollute the candidate list.
          if (/(^|\.)(clarity\.ms|google-analytics\.com|googletagmanager\.com|doubleclick\.net|googlesyndication\.com|adservice\.google\.[a-z.]+|scorecardresearch\.com|hotjar\.com|baidu\.com\/hm\.gif|cnzz\.com|umeng\.(com|cn)|miaozhen\.com|irs01\.com|mediav\.com)$/.test(u.hostname)) return;
          const path = u.pathname;
          // Tiny media assets: UI icons, stickers, preview thumbnails and ad clips
          // in ad paths. Real feature films are not 1MiB-truncated ad images.
          if (/\/(ads?|adver|advert|banner|promo|teaser|logo|icon|favicon|loading|intro|outro|opening|ending|ending|watermark|stamp|pre-roll|post-roll|tvc|cm)\b/i.test(path)) return;
          const hls = /mpegurl/i.test(mime) || /\.m3u8$/i.test(path);
          const mp4 = /video\/mp4/i.test(mime) || /\.(mp4|m4v)$/i.test(path);
          if (hls || mp4 || media)
            window.webkit.messageHandlers.harborMedia.postMessage({url:u.href,kind:hls?'hls':mp4?'mp4':'unknown',origin:origin});
        } catch {}
      };
      // Capture only small HLS blobs, never MSE video buffers or worker scripts.
      const createObjectURL = URL.createObjectURL;
      if (createObjectURL) URL.createObjectURL = function(value) {
        const url = createObjectURL.call(this,value);
        if (value && value.size <= 1024*1024 && /mpegurl/i.test(value.type || '') && typeof value.text === 'function')
          value.text().then(inlineHLS).catch(() => {});
        return url;
      };
      let lastPageState;
      const scan = () => {
        const verification = /访问验证|安全验证|人机验证/.test(document.title || '') &&
          /确认你是真人|完成验证|人机验证/.test((document.body?.innerText || '').slice(0,2000));
        if (verification !== lastPageState) {
          lastPageState = verification;
          window.webkit.messageHandlers.harborMedia.postMessage({event:'pageState',verification:String(verification)});
        }
        document.querySelectorAll('video,video source').forEach(v => send(v.currentSrc || v.src, v.type || '', true, 'video'));
        performance.getEntriesByType('resource').forEach(r => send(r.name));
      };
      // Observe requests immediately: long-running streams need not finish before detection.
      const requestURL = value => typeof value === 'string' ? value : value instanceof URL ? value.href : value && value.url;
      const originalFetch = window.fetch;
      window.fetch = function(...args) { send(requestURL(args[0]),'',false,'request'); return originalFetch.apply(this,args).then(r => {send(r.url,r.headers.get('content-type') || '',false,'request'); return r;}); };
      const open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(...args) {
        send(args[1],'',false,'request');
        this.addEventListener('load', () => { try {send(this.responseURL,this.getResponseHeader('content-type') || '',false,'request');} catch {} });
        return open.apply(this,args);
      };
      document.addEventListener('loadedmetadata',scan,true);
      document.addEventListener('play',scan,true);
      setInterval(scan,1500);
      addEventListener('DOMContentLoaded',scan);
    })();
    """#
}

private extension WKHTTPCookieStore {
    func harborCookies() async -> [HTTPCookie] { await withCheckedContinuation { c in getAllCookies { c.resume(returning:$0) } } }
}
