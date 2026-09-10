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
struct DownloadJob: Codable {
    var id = UUID().uuidString
    var candidate: MediaCandidate
    var parts: [DownloadPart]
    var state = "queued"
    var message = "等待下载"
    var output: String?
    var publicValue: [String: Any] {
        ["id":id, "title":candidate.title, "state":state,
         "done":state == "complete" ? 1 : parts.filter(\.finished).count, "total":state == "complete" ? 1 : parts.count, "message":message]
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
