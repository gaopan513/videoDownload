import Foundation

enum HarborError: LocalizedError {
    case message(String)
    case http(Int, String, String)
    var errorDescription: String? {
        switch self {
        case .message(let text): return text
        case .http(let status,let resource,let host):
            let advice = status == 404 ? "服务器未找到此资源，请重新识别或切换播放线路" : "请重新打开网页识别后重试"
            return "\(resource)请求失败（HTTP \(status)，\(host)）。\(advice)"
        }
    }
}
func webURL(_ value: String, relativeTo base: URL? = nil) throws -> URL {
    guard let u = URL(string: value, relativeTo: base)?.absoluteURL,
          ["http", "https"].contains(u.scheme?.lowercased() ?? ""), u.host != nil,
          u.user == nil, u.password == nil else { throw HarborError.message("只支持不含用户名和密码的 HTTP/HTTPS 地址") }
    return u
}
struct ByteRange: Codable, Equatable { let offset: Int64; let length: Int64 }
struct Encryption: Codable, Equatable { let url: URL; let iv: Data; var generation: Int = 0 }
struct Part: Codable, Equatable {
    let url: URL
    var range: ByteRange?
    var encryption: Encryption?
    var duration: Double = 0
    var isMap = false
    // Optional so task records written before 0.1.2 remain decodable.
    var discontinuity: Bool? = nil
}
struct Variant { let url: URL; let quality: String; let codecs: String; let audioGroup: String? }
struct AudioRendition { let group: String; let name: String; let url: URL; let isDefault: Bool }
struct Playlist {
    var variants: [Variant] = []
    var audio: [AudioRendition] = []
    var parts: [Part] = []
    var targetDuration: Double = 10
}
struct WebCookie: Codable {
    let name: String; let value: String; let domain: String; let path: String; let secure: Bool; let expires: Date?
    func matches(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        let d = domain.lowercased(), bare = d.hasPrefix(".") ? String(d.dropFirst()) : d
        let hostMatches = host == bare || (d.hasPrefix(".") && host.hasSuffix("." + bare))
        let requestPath = url.path.isEmpty ? "/" : url.path
        let pathMatches = requestPath == path || (requestPath.hasPrefix(path) && (path.hasSuffix("/") || requestPath.dropFirst(path.count).hasPrefix("/")))
        return hostMatches && pathMatches && (!secure || url.scheme == "https") && (expires == nil || expires! > Date())
    }
}
struct WebContext: Codable {
    var referer: URL
    var userAgent: String
    var cookies: [WebCookie]
    func request(_ url: URL, range: ByteRange? = nil) -> URLRequest {
        var req = URLRequest(url: url); req.timeoutInterval = 45
        req.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        if !(referer.scheme == "https" && url.scheme == "http") { req.setValue(referer.absoluteString, forHTTPHeaderField: "Referer") }
        let cookie = cookies.filter { $0.matches(url) }.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
        if !cookie.isEmpty { req.setValue(cookie, forHTTPHeaderField: "Cookie") }
        req.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        if let range { req.setValue("bytes=\(range.offset)-\(range.offset + range.length - 1)", forHTTPHeaderField: "Range") }
        return req
    }
}
struct MediaCandidate: Codable {
    var id = UUID().uuidString
    let title: String
    let url: URL
    let audioURL: URL?
    let kind: String
    let quality: String
    let context: WebContext
    var codec: String = "unknown"
    var message = "编码将在下载前进行少量探测"
    var publicValue: [String: Any] { ["id":id, "title":title, "kind":kind, "quality":quality, "codec":codec, "message":message] }
}
struct DownloadPart: Codable {
    var source: Part
    var track: Int
    var index: Int
    var key: Data?
    var finished = false
    var retries = 0
    var received: Int64 = 0
    var expected: Int64 = 0
    var validator: String?
    var sha256: String?
    var file: String { "\(track)-\(index).part" }
}
enum OutputMode: String, Codable, CaseIterable {
    case mp4, mkv, transcode
    var fileExtension: String { self == .mkv ? "mkv" : "mp4" }
    var nativeValue: Int32 { self == .mp4 ? 0 : self == .mkv ? 1 : 2 }
    var label: String { self == .mp4 ? "无损 MP4" : self == .mkv ? "无损 MKV" : "转码 MP4" }
    static func parse(_ value: String?) throws -> OutputMode {
        guard let mode = OutputMode(rawValue:value ?? "mp4") else { throw HarborError.message("不支持的输出方式") }
        return mode
    }
}
struct DownloadJob: Codable {
    var id = UUID().uuidString
    var candidate: MediaCandidate
    var parts: [DownloadPart]
    var state = "queued"
    var message = "等待下载"
    var output: String?
    var outputMode: OutputMode?
    var deepVerify: Bool?
    var mode: OutputMode { outputMode ?? .mp4 }
    var publicValue: [String: Any] {
        let progress = parts.reduce(0.0) { value,part in
            if part.finished { return value + 1 }
            guard part.expected > 0 else { return value }
            // Keep an unfinished part below 1 until its file hash is committed.
            return value + min(0.99,max(0,Double(part.received) / Double(part.expected)))
        }
        return ["id":id, "title":candidate.title, "state":state,
         "done":state == "complete" ? 1.0 : progress, "total":state == "complete" ? 1 : parts.count, "message":message,
         "mode":mode.rawValue,"format":mode.fileExtension]
    }
}

enum JobRetry {
    static func queue(_ id: String, mode: OutputMode?, jobs: inout [DownloadJob], save: ([DownloadJob]) throws -> Void) throws {
        guard let index = jobs.firstIndex(where: { $0.id == id }), ["paused","failed"].contains(jobs[index].state) else { throw HarborError.message("当前任务不能继续") }
        var updated = jobs
        for p in updated[index].parts.indices { updated[index].parts[p].retries = 0 }
        if let mode { updated[index].outputMode = mode }
        updated[index].state = "queued"; updated[index].message = "等待继续"
        try save(updated)
        jobs = updated
    }
}

enum RecordHistory {
    static func delete(_ id: String, from jobs: inout [DownloadJob], save: ([DownloadJob]) throws -> Void) throws {
        guard let job = jobs.first(where: { $0.id == id }) else { return }
        guard ["complete","cancelled"].contains(job.state) else { throw HarborError.message("请先取消任务，再删除记录") }
        let remaining = jobs.filter { $0.id != id }
        try save(remaining)
        jobs = remaining
    }
}
