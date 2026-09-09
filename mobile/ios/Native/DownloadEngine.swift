import Foundation
import UIKit
import CryptoKit

@MainActor final class DownloadEngine: NSObject, @preconcurrency URLSessionDownloadDelegate {
    static let shared: Result<DownloadEngine,Error> = Result { try DownloadEngine(restoring:true) }
    static let sessionID = "local.streamharbor.ios.downloads"
    private let store: SecureStore
    private(set) var jobs: [DownloadJob]
    private var transfers: [String:URLSessionDownloadTask] = [:]
    private var ready = false
    private var processing = false
    private var observer: NSObjectProtocol?
    // Use a private cookie store rather than a literal Cookie request header. Background
    // redirects never call the redirect delegate; URLSession must apply cookie scoping itself.
    private let cookies = URLSessionConfiguration.ephemeral.httpCookieStorage!
    var changed: (([[String:Any]]) -> Void)?
    var backgroundCompletion: (() -> Void)?
    var startup: Task<Void,Never>?
    var storageError: String?
    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.background(withIdentifier:Self.sessionID)
        c.sessionSendsLaunchEvents = true; c.isDiscretionary = false
        c.httpMaximumConnectionsPerHost = 4; c.httpShouldSetCookies = true
        c.httpCookieStorage = cookies; c.urlCredentialStorage = nil
        c.timeoutIntervalForRequest = 60; c.timeoutIntervalForResource = 24*60*60
        return URLSession(configuration:c,delegate:self,delegateQueue:.main)
    }()
    private init(restoring: Bool) throws {
        store = try SecureStore(); jobs = try store.load()
        super.init()
        hydrateCookies()
        observer = NotificationCenter.default.addObserver(forName:UIApplication.didBecomeActiveNotification,object:nil,queue:.main) { [weak self] _ in
            Task { @MainActor in self?.schedule() }
        }
        startup = Task { await reconnect() }
    }
    private func reconnect() async {
        let active = await session.allTasks
        for task in active {
            guard let download = task as? URLSessionDownloadTask, let name = task.taskDescription,
                  let (j,p) = indices(name), !jobs[j].parts[p].finished,
                  !["complete","cancelled","failed"].contains(jobs[j].state) else { task.cancel(); continue }
            transfers[name] = download
            download.suspend()
        }
        for j in jobs.indices where !["complete","cancelled"].contains(jobs[j].state) {
            if jobs[j].state == "processing" { jobs[j].state = "waitingForeground" }
            do {
                let directory = try store.directory(jobs[j].id)
                for part in jobs[j].parts where part.finished {
                    let file = directory.appendingPathComponent(part.file)
                    guard let expected = part.sha256, try Self.hash(file) == expected else { throw HarborError.message("已下载分片校验失败，请取消此任务并重新下载") }
                }
                if jobs[j].candidate.kind == "hls", jobs[j].parts.contains(where: \.finished), !jobs[j].parts.allSatisfy(\.finished), jobs[j].state != "paused" {
                    // A process restart may outlive the playlist's authorization. Do not append
                    // newly fetched bytes to saved fragments before revalidating the full plan.
                    jobs[j].state = "paused"
                    jobs[j].message = "已恢复分片；点击继续以校验资源和密钥是否仍一致"
                }
            } catch { jobs[j].state = "failed"; jobs[j].message = "恢复校验失败，旧数据已保留；请取消后重新下载"; suspend(jobs[j].id) }
        }
        ready = true; persist(); schedule()
    }
    func add(_ candidate: MediaCandidate, parts: [DownloadPart]) throws {
        guard storageError == nil else { throw HarborError.message(storageError!) }
        guard !parts.isEmpty else { throw HarborError.message("没有可下载的媒体分片") }
        let job = DownloadJob(candidate:candidate,parts:parts)
        _ = try store.directory(job.id)
        jobs.append(job)
        do { try store.save(jobs) } catch { jobs.removeLast(); throw HarborError.message("无法保存任务，下载未开始") }
        hydrateCookies()
        publish(); schedule()
    }
    func control(_ id: String, action: String) async throws {
        guard let j = jobs.firstIndex(where: { $0.id == id }) else { throw HarborError.message("任务不存在") }
        switch action {
        case "pause":
            guard ["queued","downloading"].contains(jobs[j].state) else { throw HarborError.message("此阶段不能暂停") }
            jobs[j].state = "paused"; jobs[j].message = "已暂停，临时数据保留"; suspend(id)
        case "resume", "retry":
            guard ["paused","failed"].contains(jobs[j].state) else { throw HarborError.message("当前任务不能继续") }
            if jobs[j].candidate.kind == "hls" && !jobs[j].parts.allSatisfy(\.finished) {
                let old = jobs[j]
                let http = HTTP(old.candidate.context); defer { http.close() }
                let fresh = try await http.prepare(old.candidate)
                guard jobs[j].state == old.state else { throw HarborError.message("任务状态已改变，请重试") }
                guard fresh.count == old.parts.count, zip(fresh,old.parts).allSatisfy({ pair in pair.0.source == pair.1.source && pair.0.key == pair.1.key }) else { throw HarborError.message("资源已变化，无法安全续传。旧数据保留，请取消后重新解析下载") }
            }
            for p in jobs[j].parts.indices { jobs[j].parts[p].retries = 0 }
            jobs[j].state = "queued"; jobs[j].message = "等待继续"
        case "cancel":
            guard !["complete","processing","cancelled"].contains(jobs[j].state) else { throw HarborError.message("此阶段不能取消") }
            let names = transfers.keys.filter { $0.hasPrefix(id + ":") }
            for name in names { transfers.removeValue(forKey:name)?.cancel() }
            let directory = try store.directory(id)
            try FileManager.default.removeItem(at:directory)
            jobs[j].state = "cancelled"; jobs[j].message = "已取消，临时数据已删除"; scrub(j)
        default: throw HarborError.message("不支持的任务操作")
        }
        try store.save(jobs); publish(); schedule()
    }
    func output(_ id: String) throws -> URL {
        guard let job = jobs.first(where:{$0.id == id}), job.state == "complete", let filename = job.output,
              filename == id + ".mp4" else { throw HarborError.message("视频尚未完成") }
        let path = try FileManager.default.url(for:.documentDirectory,in:.userDomainMask,appropriateFor:nil,create:true).appendingPathComponent(filename)
        guard FileManager.default.fileExists(atPath:path.path) else { throw HarborError.message("视频文件已被移动或删除") }
        return path
    }
    private func suspend(_ id: String) { for (name,task) in transfers where name.hasPrefix(id + ":") { task.suspend() } }
    private func schedule() {
        guard ready, storageError == nil else { return }
        var active = jobs.filter { $0.state == "downloading" }.count
        for j in jobs.indices {
            if jobs[j].state == "queued", active < 2 { jobs[j].state = "downloading"; active += 1 }
            guard jobs[j].state == "downloading" else { continue }
            if jobs[j].parts.allSatisfy(\.finished) { jobs[j].state = "waitingForeground"; jobs[j].message = "下载完成，回到前台后合并"; active -= 1; continue }
            let id = jobs[j].id
            var count = transfers.keys.filter { $0.hasPrefix(id + ":") }.count
            for (name,task) in transfers where name.hasPrefix(id + ":") && task.state == .suspended { task.resume() }
            for p in jobs[j].parts.indices where !jobs[j].parts[p].finished {
                let name = "\(id):\(p)"
                guard count < 4 else { break }
                if transfers[name] != nil { continue }
                let part = jobs[j].parts[p]
                var req = jobs[j].candidate.context.request(part.source.url,range:part.source.range)
                req.setValue(nil,forHTTPHeaderField:"Cookie")
                let task = session.downloadTask(with:req); task.taskDescription = name
                transfers[name] = task; count += 1
                // Save source, key and destination before allowing a background transfer to start.
                guard persist() else { task.cancel(); return }
                task.resume()
            }
        }
        persist(); publish()
        if UIApplication.shared.applicationState == .active && !processing,
           let j = jobs.firstIndex(where:{$0.state == "waitingForeground"}) { merge(j) }
    }
    private func indices(_ name: String) -> (Int,Int)? {
        let bits = name.split(separator:":")
        guard bits.count == 2, let j = jobs.firstIndex(where:{$0.id == String(bits[0])}), let p = Int(bits[1]), jobs[j].parts.indices.contains(p) else { return nil }
        return (j,p)
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let name = downloadTask.taskDescription, let (j,p) = indices(name) else { return }
        jobs[j].parts[p].received = totalBytesWritten; jobs[j].parts[p].expected = totalBytesExpectedToWrite
        if jobs[j].candidate.kind == "hls", totalBytesWritten > 256*1024*1024 {
            jobs[j].state = "failed"; jobs[j].message = "单个 HLS 分片超过 256 MiB，原型无法处理"; downloadTask.cancel(); persist()
        } else if jobs[j].state == "downloading" {
            jobs[j].message = jobs[j].candidate.kind == "hls" ? "已完成 \(jobs[j].parts.filter(\.finished).count) / \(jobs[j].parts.count) 个分片" : "已接收 \(totalBytesWritten / 1024 / 1024) MiB"
        }
        publish()
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let name = downloadTask.taskDescription, let (j,p) = indices(name), !["cancelled","failed"].contains(jobs[j].state) else { return }
        do {
            guard let response = downloadTask.response as? HTTPURLResponse else { throw HarborError.message("媒体响应无效") }
            guard (200...299).contains(response.statusCode) else {
                throw HarborError.message([401,403,410].contains(response.statusCode) ? "链接或授权失效。请重新打开网页识别；无法确认同一资源时须重新下载" : "下载失败（HTTP \(response.statusCode)），可重试")
            }
            let size = try FileManager.default.attributesOfItem(atPath:location.path)[.size] as? NSNumber
            guard let bytes = size?.int64Value, bytes > 0 else { throw HarborError.message("服务器返回空文件") }
            if let range = jobs[j].parts[p].source.range {
                guard response.statusCode == 206, bytes == range.length,
                      response.value(forHTTPHeaderField:"Content-Range")?.hasPrefix("bytes \(range.offset)-\(range.offset + range.length - 1)/") == true else { throw HarborError.message("服务器返回的字节范围不一致，拒绝合并") }
            } else {
                guard response.statusCode == 200 else { throw HarborError.message("服务器返回非完整媒体，拒绝保存") }
            }
            if jobs[j].candidate.kind == "hls", bytes > 256*1024*1024 { throw HarborError.message("单个 HLS 分片超过 256 MiB") }
            let target = try store.directory(jobs[j].id).appendingPathComponent(jobs[j].parts[p].file)
            if FileManager.default.fileExists(atPath:target.path) { try FileManager.default.removeItem(at:target) }
            try FileManager.default.moveItem(at:location,to:target)
            try FileManager.default.setAttributes([.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication],ofItemAtPath:target.path)
            jobs[j].parts[p].sha256 = try Self.hash(target)
            jobs[j].parts[p].validator = response.value(forHTTPHeaderField:"ETag") ?? response.value(forHTTPHeaderField:"Last-Modified")
            jobs[j].parts[p].finished = true; jobs[j].parts[p].received = bytes; jobs[j].parts[p].expected = bytes
            persist(); publish()
        } catch {
            jobs[j].state = "failed"; jobs[j].message = Self.safeError(error); suspend(jobs[j].id); persist(); publish()
        }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let name = task.taskDescription else { return }
        transfers.removeValue(forKey:name)
        if let (j,p) = indices(name), let error, jobs[j].state == "downloading", !jobs[j].parts[p].finished {
            jobs[j].parts[p].retries += 1
            if jobs[j].parts[p].retries > 2 {
                jobs[j].state = "failed"; jobs[j].message = "网络中断或下载失败，临时数据保留，可重试"; suspend(jobs[j].id)
            }
            _ = error // Never expose URLs embedded in NSError descriptions.
        }
        persist(); schedule()
    }
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        persist(); schedule()
        let callback = backgroundCompletion; backgroundCompletion = nil; callback?()
    }
    private func merge(_ index: Int) {
        processing = true; jobs[index].state = "processing"; jobs[index].message = "正在校验并合并 MP4，请保持应用在前台"
        guard persist() else { processing = false; return }; publish()
        let job = jobs[index]
        do {
            let directory = try store.directory(job.id)
            let docs = try FileManager.default.url(for:.documentDirectory,in:.userDomainMask,appropriateFor:nil,create:true)
            let output = docs.appendingPathComponent(job.id + ".mp4")
            Task {
                do {
                    try await Task.detached(priority:.utility) { try Self.process(job,directory:directory,output:output) }.value
                    guard let j = self.jobs.firstIndex(where:{$0.id == job.id}) else { return }
                    self.jobs[j].state = "complete"; self.jobs[j].message = "已保存到手机，可分享或导出"; self.jobs[j].output = output.lastPathComponent
                    self.scrub(j)
                    if self.persist() { try? FileManager.default.removeItem(at:directory) }
                } catch {
                    if let j = self.jobs.firstIndex(where:{$0.id == job.id}) { self.jobs[j].state = "failed"; self.jobs[j].message = Self.safeError(error) }
                }
                self.processing = false; self.persist(); self.publish(); self.schedule()
            }
        } catch { jobs[index].state = "failed"; jobs[index].message = Self.safeError(error); processing = false; persist(); publish() }
    }
    private nonisolated static func process(_ job: DownloadJob, directory: URL, output: URL) throws {
        let temporary = directory.appendingPathComponent("result.mp4")
        if FileManager.default.fileExists(atPath:temporary.path) { try FileManager.default.removeItem(at:temporary) }
        var inputs: [URL] = []
        for track in Set(job.parts.map(\.track)).sorted() {
            let parts = job.parts.filter { $0.track == track }.sorted { $0.index < $1.index }
            if job.candidate.kind == "mp4" { inputs.append(directory.appendingPathComponent(parts[0].file)); continue }
            let maxDuration = Int(ceil(parts.map { $0.source.duration }.max() ?? 10))
            var lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-TARGETDURATION:\(max(1,maxDuration))", "#EXT-X-MEDIA-SEQUENCE:0"]
            for part in parts {
                let original = directory.appendingPathComponent(part.file)
                guard let expected = part.sha256, try hash(original) == expected else { throw HarborError.message("分片校验失败，拒绝合并") }
                let plain = directory.appendingPathComponent(part.file + ".plain")
                if FileManager.default.fileExists(atPath:plain.path) { try FileManager.default.removeItem(at:plain) }
                if let encryption = part.source.encryption, let key = part.key {
                    let data = try NativeMedia.decrypt(Data(contentsOf:original,options:.mappedIfSafe),key:key,iv:encryption.iv)
                    try data.write(to:plain,options:.completeFileProtectionUntilFirstUserAuthentication)
                } else { try FileManager.default.linkItem(at:original,to:plain) }
                if part.source.isMap { lines.append("#EXT-X-MAP:URI=\"\(plain.lastPathComponent)\"") }
                else { lines.append("#EXTINF:\(part.source.duration),"); lines.append(plain.lastPathComponent) }
            }
            lines.append("#EXT-X-ENDLIST")
            let input = directory.appendingPathComponent("track-\(track).m3u8")
            try lines.joined(separator:"\n").write(to:input,atomically:true,encoding:.utf8); inputs.append(input)
        }
        try NativeMedia.remux(video:inputs[0],audio:inputs.count > 1 ? inputs[1] : nil,output:temporary)
        guard !FileManager.default.fileExists(atPath:output.path) else { throw HarborError.message("输出文件已存在，未覆盖；请检查文件应用") }
        try FileManager.default.moveItem(at:temporary,to:output)
    }
    private func scrub(_ j: Int) {
        let old = jobs[j].candidate, redacted = URL(string:"https://removed.invalid/")!
        jobs[j].candidate = MediaCandidate(title:old.title,url:redacted,audioURL:nil,kind:old.kind,quality:old.quality,context:WebContext(referer:redacted,userAgent:"",cookies:[]))
        jobs[j].parts = []
        hydrateCookies()
    }
    private func hydrateCookies() {
        for cookie in cookies.cookies ?? [] { cookies.deleteCookie(cookie) }
        for job in jobs where !["complete","cancelled"].contains(job.state) {
            for c in job.candidate.context.cookies where c.expires == nil || c.expires! > Date() {
                var properties: [HTTPCookiePropertyKey:Any] = [.name:c.name,.value:c.value,.domain:c.domain,.path:c.path]
                if c.secure { properties[.secure] = "TRUE" }
                if let expires = c.expires { properties[.expires] = expires }
                if let cookie = HTTPCookie(properties:properties) { cookies.setCookie(cookie) }
            }
        }
    }
    @discardableResult private func persist() -> Bool {
        do { try store.save(jobs); return true }
        catch { storageError = "任务记录无法保存，请检查手机可用空间后重新打开应用"; for task in transfers.values { task.suspend() }; return false }
    }
    private func publish() { changed?(jobs.map(\.publicValue)) }
    private nonisolated static func safeError(_ error: Error) -> String {
        (error as? HarborError)?.errorDescription ?? "文件或媒体处理失败，请检查可用空间；临时数据保留"
    }
    private nonisolated static func hash(_ path: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom:path); defer { try? handle.close() }
        var sha = SHA256()
        while let bytes = try handle.read(upToCount:1024*1024), !bytes.isEmpty { sha.update(data:bytes) }
        return sha.finalize().map { String(format:"%02x",$0) }.joined()
    }
}
