import Foundation

struct MediaCheck { let codec: String; let message: String }

final class HTTP: NSObject, URLSessionTaskDelegate {
    let context: WebContext
    init(_ context: WebContext) { self.context = context }
    lazy var session: URLSession = {
        let c = URLSessionConfiguration.ephemeral; c.httpShouldSetCookies = false; c.httpCookieStorage = nil; c.urlCredentialStorage = nil; c.urlCache = nil
        // Idle timeout 15s: resolution probes small metadata requests, so a silent
        // host should fail quickly. Resource timeout 90s: still allows slow but
        // actively streaming responses to finish.
        c.timeoutIntervalForRequest = 15; c.timeoutIntervalForResource = 90
        return URLSession(configuration:c,delegate:self,delegateQueue:nil)
    }()
    func close() { session.invalidateAndCancel() }
    func mediaKind(_ url: URL) async throws -> String {
        let (stream,response) = try await session.bytes(for:context.request(url,range:ByteRange(offset:0,length:511)))
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { throw HarborError.message("媒体探测请求失败") }
        let mime = (http.mimeType ?? "").lowercased()
        if mime.contains("mpegurl") { return "hls" }
        if mime == "video/mp4" { return "mp4" }
        var prefix = Data()
        for try await byte in stream { prefix.append(byte); if prefix.count >= 512 { break } }
        if String(data:prefix,encoding:.utf8)?.trimmingCharacters(in:.whitespacesAndNewlines).hasPrefix("#EXTM3U") == true { return "hls" }
        if prefix.count >= 8, String(data:prefix.subdata(in:4..<8),encoding:.ascii) == "ftyp" { return "mp4" }
        throw HarborError.message("视频地址未返回可识别的 MP4/HLS")
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let u = request.url, (try? webURL(u.absoluteString)) != nil else { completionHandler(nil); return }
        var req = context.request(u)
        req.setValue(task.originalRequest?.value(forHTTPHeaderField:"Range"),forHTTPHeaderField:"Range")
        completionHandler(req)
    }
    func read(_ url: URL, range: ByteRange? = nil, limit: Int = 4 * 1024 * 1024, resource: String = "媒体") async throws -> (Data, URL, String) {
        let (stream,response) = try await session.bytes(for:context.request(url,range:range))
        guard let http = response as? HTTPURLResponse else { throw HarborError.message("媒体响应无效") }
        guard (200...299).contains(http.statusCode) else { throw HarborError.http(http.statusCode,resource,response.url?.host ?? url.host ?? "媒体服务器") }
        if let range {
            guard http.statusCode == 206, let content = http.value(forHTTPHeaderField:"Content-Range"), content.hasPrefix("bytes \(range.offset)-\(range.offset + range.length - 1)/") else { throw HarborError.message("服务器未返回请求的字节范围") }
        }
        // Fast path: when the server states the size, one buffer read replaces tens
        // of thousands of per-byte suspensions (a 45 KiB playlist is 45,000 of them).
        if let lengthText = http.value(forHTTPHeaderField:"Content-Length"), let length = Int(lengthText), length > 0, length <= limit {
            let (data,_) = try await session.data(for:context.request(url,range:range))
            guard data.count == length else { throw HarborError.message("响应长度与声明不一致") }
            if let range, data.count != Int(range.length) { throw HarborError.message("分片长度与请求范围不一致") }
            return (data,response.url ?? url,http.mimeType ?? "")
        }
        var data = Data()
        for try await byte in stream {
            try Task.checkCancellation()
            guard data.count < limit else { throw HarborError.message("探测响应过大，请通过网页重新识别") }
            data.append(byte)
        }
        if let range, Int64(data.count) != range.length { throw HarborError.message("分片长度与请求范围不一致") }
        return (data,response.url ?? url,http.mimeType ?? "")
    }
    func playlist(_ url: URL) async throws -> Playlist {
        let (data,base,_) = try await read(url,resource:"播放列表")
        guard let text = String(data:data,encoding:.utf8) else { throw HarborError.message("播放列表不是 UTF-8") }
        return try HLS.parse(text,base:base)
    }
    // Byte-range download turns a single-connection MP4 into several parallel
    // short requests. Only used when the server answers 206 to a one-byte probe
    // and reports a total length, so unsupported servers keep the old path.
    func mp4Ranges(_ url: URL) async -> [ByteRange]? {
        // Stream the probe: a server that ignores Range would otherwise make this
        // buffer the whole video just to decide the download plan.
        guard let (stream,response) = try? await session.bytes(for:context.request(url,range:ByteRange(offset:0,length:1))),
              let http = response as? HTTPURLResponse, http.statusCode == 206,
              let contentRange = http.value(forHTTPHeaderField:"Content-Range"),
              let slash = contentRange.lastIndex(of:"/"),
              let total = Int64(contentRange[contentRange.index(after:slash)...].trimmingCharacters(in:.whitespaces))
        else { return nil }
        let mime = (http.mimeType ?? "").lowercased()
        guard mime.contains("mp4") || mime.contains("octet-stream") || mime.isEmpty else { return nil }
        // Drain the single probe byte so the connection can be reused.
        do { for try await byte in stream { _ = byte; break } } catch { return nil }
        return DownloadScheduling.mp4Chunks(totalLength:total,acceptsRanges:true)
    }
    func prepare(_ candidate: MediaCandidate) async throws -> [DownloadPart] {
        if candidate.kind == "mp4" {
            let chunks = await mp4Ranges(candidate.url)
            guard let chunks else { return [DownloadPart(source:Part(url:candidate.url),track:0,index:0)] }
            return chunks.enumerated().map { index,range in
                DownloadPart(source:Part(url:candidate.url,range:range),track:0,index:index)
            }
        }
        var output: [DownloadPart] = []
        for (track,url) in ([candidate.url] + (candidate.audioURL.map { [$0] } ?? [])).enumerated() {
            let playlist: Playlist
            if track == 0, let text = candidate.inlinePlaylist {
                playlist = try HLS.parse(text,base:url)
            } else { playlist = try await self.playlist(url) }
            guard playlist.variants.isEmpty else { throw HarborError.message("请选择具体清晰度，不能直接下载主播放列表") }
            // Read each key declaration occurrence rather than cache solely by URI: servers can rotate bytes at the same URI.
            var previous: Encryption?, key: Data?
            for (index,part) in playlist.parts.enumerated() {
                if let encryption = part.encryption {
                    if previous?.url != encryption.url || previous?.generation != encryption.generation { key = try await read(encryption.url,limit:16,resource:"AES 密钥").0; guard key?.count == 16 else { throw HarborError.message("AES 密钥必须为 16 字节") } }
                } else { key = nil }
                output.append(DownloadPart(source:part,track:track,index:index,key:key)); previous = part.encryption
            }
        }
        return output
    }
    func preflight(_ candidate: MediaCandidate, parts: [DownloadPart], mode: OutputMode = .mp4) async throws -> MediaCheck {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:directory) }
        do {
            try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
            var descriptions: [String] = []
            for track in Set(parts.map(\.track)).sorted() {
                let items = parts.filter { $0.track == track }
                var sample = Data()
                for part in items.prefix(items.first?.source.isMap == true ? 2 : 1) {
                    let range = candidate.kind == "mp4" ? ByteRange(offset:0,length:1024*1024) : part.source.range
                    let resource = candidate.kind == "mp4" ? "MP4 样本" : part.source.isMap ? "HLS 初始化片段" : "HLS 分片 \(part.index + 1)"
                    var data = try await read(part.source.url,range:range,limit:16*1024*1024,resource:resource).0
                    if let encryption = part.source.encryption, let key = part.key { data = try NativeMedia.decrypt(data,key:key,iv:encryption.iv) }
                    sample.append(data)
                }
                let path = directory.appendingPathComponent("sample-\(track)")
                try sample.write(to:path)
                let result = NativeMedia.probe(path,video:track == 0,audio:track == 1,mode:mode)
                let detail = NativeMedia.codecs(path)
                if !detail.isEmpty { descriptions.append(detail) }
                if result == -2 { return MediaCheck(codec:"unsupported",message:descriptions.joined(separator:"；") + "。不适合\(mode.label)，请选择无损 MKV 或转码 MP4") }
                if result != 1 { return MediaCheck(codec:"unknown",message:"样本不足以确认编码，可选择尝试；下载后会再次检查") }
            }
            return MediaCheck(codec:"supported",message:descriptions.joined(separator:"；") + "。可使用\(mode.label)；能否存入相册由导出时检查")
        } catch let error as HarborError {
            if case .http = error { throw error }
            return MediaCheck(codec:"unknown",message:"样本不足以确认编码，可选择尝试")
        } catch { return MediaCheck(codec:"unknown",message:"样本检查未完成，可选择尝试") }
    }
}
