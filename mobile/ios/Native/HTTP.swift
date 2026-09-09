import Foundation

final class HTTP: NSObject, URLSessionTaskDelegate {
    let context: WebContext
    init(_ context: WebContext) { self.context = context }
    lazy var session: URLSession = {
        let c = URLSessionConfiguration.ephemeral; c.httpShouldSetCookies = false; c.httpCookieStorage = nil; c.urlCredentialStorage = nil; c.urlCache = nil
        c.timeoutIntervalForRequest = 30; c.timeoutIntervalForResource = 60
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
    func read(_ url: URL, range: ByteRange? = nil, limit: Int = 4 * 1024 * 1024) async throws -> (Data, URL, String) {
        let (stream,response) = try await session.bytes(for:context.request(url,range:range))
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { throw HarborError.message("媒体请求失败，可能需要重新打开网页或授权") }
        if let range {
            guard http.statusCode == 206, let content = http.value(forHTTPHeaderField:"Content-Range"), content.hasPrefix("bytes \(range.offset)-\(range.offset + range.length - 1)/") else { throw HarborError.message("服务器未返回请求的字节范围") }
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
        let (data,base,_) = try await read(url)
        guard let text = String(data:data,encoding:.utf8) else { throw HarborError.message("播放列表不是 UTF-8") }
        return try HLS.parse(text,base:base)
    }
    func prepare(_ candidate: MediaCandidate) async throws -> [DownloadPart] {
        if candidate.kind == "mp4" { return [DownloadPart(source:Part(url:candidate.url),track:0,index:0)] }
        var output: [DownloadPart] = []
        for (track,url) in ([candidate.url] + (candidate.audioURL.map { [$0] } ?? [])).enumerated() {
            let playlist = try await playlist(url)
            guard playlist.variants.isEmpty else { throw HarborError.message("请选择具体清晰度，不能直接下载主播放列表") }
            // Read each key declaration occurrence rather than cache solely by URI: servers can rotate bytes at the same URI.
            var previous: Encryption?, key: Data?
            for (index,part) in playlist.parts.enumerated() {
                if let encryption = part.encryption {
                    if previous?.url != encryption.url || previous?.generation != encryption.generation { key = try await read(encryption.url,limit:16).0; guard key?.count == 16 else { throw HarborError.message("AES 密钥必须为 16 字节") } }
                } else { key = nil }
                output.append(DownloadPart(source:part,track:track,index:index,key:key)); previous = part.encryption
            }
        }
        return output
    }
    func preflight(_ candidate: MediaCandidate, parts: [DownloadPart]) async -> String {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:directory) }
        do {
            try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
            for track in Set(parts.map(\.track)).sorted() {
                let items = parts.filter { $0.track == track }
                var sample = Data()
                for part in items.prefix(items.first?.source.isMap == true ? 2 : 1) {
                    let range = candidate.kind == "mp4" ? ByteRange(offset:0,length:1024*1024) : part.source.range
                    var data = try await read(part.source.url,range:range,limit:16*1024*1024).0
                    if let encryption = part.source.encryption, let key = part.key { data = try NativeMedia.decrypt(data,key:key,iv:encryption.iv) }
                    sample.append(data)
                }
                let path = directory.appendingPathComponent("sample-\(track)")
                try sample.write(to:path)
                let result = NativeMedia.probe(path,video:track == 0,audio:track == 1)
                if result == -2 { return "unsupported" }
                if result != 1 { return "unknown" }
            }
            return "supported"
        } catch { return "unknown" }
    }
}
