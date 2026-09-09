import UIKit
import WebKit

// Untrusted sites live in this separate WebView, never in the Capacitor bridge view.
@MainActor final class Resolver: NSObject, WKScriptMessageHandler, WKNavigationDelegate, UIAdaptivePresentationControllerDelegate {
    private var web: WKWebView?
    private var navigation: UINavigationController?
    private var continuation: CheckedContinuation<[MediaCandidate], Error>?
    private var timeout: Task<Void,Never>?
    private var discovered: [(URL,URL,String)] = []
    private var source: URL?
    private var finishing = false
    private var userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"

    func resolve(_ url: URL, interactive: Bool, presenter: UIViewController) async throws -> [MediaCandidate] {
        guard continuation == nil else { throw HarborError.message("已有网页正在识别") }
        if ["mp4","m3u8"].contains(url.pathExtension.lowercased()) && !interactive {
            return try await expand(url,context:WebContext(referer:url,userAgent:userAgent,cookies:[]),title:"视频",hint:url.pathExtension == "m3u8" ? "hls" : "mp4")
        }
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation; self.source = url; discovered = []; finishing = false
            let controller = WKUserContentController()
            controller.add(self,name:"harborMedia")
            controller.addUserScript(WKUserScript(source:Self.script,injectionTime:.atDocumentStart,forMainFrameOnly:false))
            let config = WKWebViewConfiguration()
            config.userContentController = controller; config.websiteDataStore = .nonPersistent()
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
        guard !finishing, discovered.count < 64, let info = message.body as? [String:String],
              let raw = info["url"], raw.count <= 8192, let url = try? webURL(raw),
              let frame = message.frameInfo.request.url, (try? webURL(frame.absoluteString)) != nil else { return }
        if !discovered.contains(where: { $0.0 == url }) { discovered.append((url,frame,info["kind"] == "hls" ? "hls" : "mp4")) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, (try? webURL(url.absoluteString)) != nil else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame == nil { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let mime = navigationResponse.response.mimeType ?? ""
        if let url = navigationResponse.response.url, let source, mime.contains("mpegurl") || mime == "video/mp4" {
            if discovered.count < 64 && !discovered.contains(where: { $0.0 == url }) { discovered.append((url,source,mime.contains("mpegurl") ? "hls" : "mp4")) }
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
        finishing = true; timeout?.cancel()
        navigation?.topViewController?.navigationItem.rightBarButtonItem?.isEnabled = false
        Task { @MainActor in
            let cookies = await web.configuration.websiteDataStore.httpCookieStore.harborCookies()
            let stored = cookies.map { WebCookie(name:$0.name,value:$0.value,domain:$0.domain,path:$0.path,secure:$0.isSecure,expires:$0.expiresDate) }
            let rawAgent = try? await web.evaluateJavaScript("navigator.userAgent")
            if let agentString = rawAgent as? String { userAgent = agentString }
            let title = String((web.title ?? "视频").prefix(160))
            var results: [MediaCandidate] = []
            // Process only a bounded number of detections; the user can reopen the page for another player.
            for (url,referer,hint) in discovered.prefix(12) {
                let context = WebContext(referer:referer,userAgent:userAgent,cookies:stored)
                let items = try? await expand(url,context:context,title:title,hint:hint)
                if let items { results.append(contentsOf:items) }
            }
            if results.isEmpty { finish(.failure(HarborError.message("未识别到可下载的 MP4/HLS。请确认视频已播放；该站可能需要进一步适配。"))) }
            else { finish(.success(Array(results.prefix(32)))) }
        }
    }
    private func finish(_ result: Result<[MediaCandidate],Error>) {
        timeout?.cancel(); timeout = nil
        web?.stopLoading(); web?.configuration.userContentController.removeScriptMessageHandler(forName:"harborMedia")
        navigation?.dismiss(animated:true); navigation = nil; web = nil; discovered = []
        let saved = continuation; continuation = nil; finishing = false; saved?.resume(with:result)
    }
    private func expand(_ url: URL, context: WebContext, title: String, hint: String) async throws -> [MediaCandidate] {
        if hint == "mp4" { return [MediaCandidate(title:title,url:url,audioURL:nil,kind:"mp4",quality:"源画质",context:context)] }
        let http = HTTP(context); defer { http.close() }
        let playlist = try await http.playlist(url)
        if playlist.variants.isEmpty { return [MediaCandidate(title:title,url:url,audioURL:nil,kind:"hls",quality:"源画质",context:context)] }
        return playlist.variants.prefix(16).flatMap { variant -> [MediaCandidate] in
            let tracks = playlist.audio.filter { $0.group == variant.audioGroup }
            if tracks.isEmpty { return [MediaCandidate(title:title,url:variant.url,audioURL:nil,kind:"hls",quality:variant.quality,context:context)] }
            return tracks.map { MediaCandidate(title:title,url:variant.url,audioURL:$0.url,kind:"hls",quality:variant.quality + " · " + $0.name,context:context) }
        }
    }
    private static let script = #"""
    (() => {
      const send = (raw, mime = '') => {
        try {
          const u = new URL(raw, location.href);
          if (!/^https?:$/.test(u.protocol)) return;
          const hls = /mpegurl/i.test(mime) || /\.m3u8$/i.test(u.pathname);
          if (hls || /video\/mp4/i.test(mime) || /\.(mp4|m4v)$/i.test(u.pathname))
            window.webkit.messageHandlers.harborMedia.postMessage({url:u.href,kind:hls?'hls':'mp4'});
        } catch {}
      };
      const scan = () => {
        document.querySelectorAll('video,source').forEach(v => send(v.currentSrc || v.src, v.type || ''));
        performance.getEntriesByType('resource').forEach(r => send(r.name));
      };
      const originalFetch = window.fetch;
      window.fetch = function(...args) { return originalFetch.apply(this,args).then(r => {send(r.url,r.headers.get('content-type') || ''); return r;}); };
      const open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(...args) {
        this.addEventListener('load', () => { try {send(this.responseURL,this.getResponseHeader('content-type') || '');} catch {} });
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
