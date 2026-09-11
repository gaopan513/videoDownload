import Foundation
import UIKit
import CryptoKit

@MainActor final class DownloadEngine: NSObject, @preconcurrency URLSessionDownloadDelegate {
    static let shared: Result<DownloadEngine,Error> = Result { try DownloadEngine() }
    static let sessionID = "local.streamharbor.ios.downloads"
    private let store: SecureStore
    private(set) var jobs: [DownloadJob]
    private(set) var transfers: [String:URLSessionDownloadTask] = [:]
    private var foregroundTransfers = Set<String>()
    private var foreground = UIApplication.shared.applicationState == .active
    private let foregroundConfiguration: URLSessionConfiguration?
    private let backgroundConfiguration: URLSessionConfiguration?
    private var finalization = DownloadFinalizationGate()
    private let hashQueue = DispatchQueue(label:"local.streamharbor.download-hash",qos:.utility)
    private static let verifyQueue = DispatchQueue(label:"local.streamharbor.download-verify",qos:.utility)
    // Serializes encrypted state writes so ordering matches state transitions.
    private let saveQueue = DispatchQueue(label:"local.streamharbor.download-save",qos:.utility)
    private var pendingSave = false
    private var saveInFlight = false
    private var progressThrottle = DownloadProgressThrottle()
    private var ready = false
    private var processing = false
    private var observer: NSObjectProtocol?
    private var backgroundObserver: NSObjectProtocol?
    private var progressTimer: Task<Void,Never>?
    private var activity: [String:DownloadActivity] = [:]
    // Use a private cookie store rather than a literal Cookie request header. Background
    // redirects never call the redirect delegate; URLSession must apply cookie scoping itself.
    private let cookies = URLSessionConfiguration.ephemeral.httpCookieStorage!
    var changed: (([[String:Any]]) -> Void)?
    var backgroundCompletion: (() -> Void)? { didSet { finishBackgroundEventsIfReady() } }
    var startup: Task<Void,Never>?
    var storageError: String?
    private lazy var session: URLSession = {
        let c = backgroundConfiguration ?? URLSessionConfiguration.background(withIdentifier:Self.sessionID)
        c.sessionSendsLaunchEvents = true; c.isDiscretionary = false
        c.httpMaximumConnectionsPerHost = DownloadScheduling.connectionsPerHost; c.httpShouldSetCookies = true
        c.httpCookieStorage = cookies; c.urlCredentialStorage = nil
        c.timeoutIntervalForRequest = 60; c.timeoutIntervalForResource = 24*60*60
        return URLSession(configuration:c,delegate:self,delegateQueue:.main)
    }()
    private lazy var foregroundSession: URLSession = {
        let c = foregroundConfiguration ?? URLSessionConfiguration.ephemeral
        c.httpMaximumConnectionsPerHost = DownloadScheduling.connectionsPerHost
        c.httpShouldSetCookies = true; c.httpCookieStorage = cookies
        c.urlCredentialStorage = nil; c.urlCache = nil
        c.timeoutIntervalForRequest = 45; c.timeoutIntervalForResource = 24*60*60
        return URLSession(configuration:c,delegate:self,delegateQueue:.main)
    }()
    init(store: SecureStore? = nil, foregroundConfiguration: URLSessionConfiguration? = nil,
         backgroundConfiguration: URLSessionConfiguration? = nil, observeLifecycle: Bool = true) throws {
        self.store = try store ?? SecureStore(); jobs = try self.store.load()
        self.foregroundConfiguration = foregroundConfiguration; self.backgroundConfiguration = backgroundConfiguration
        super.init()
        hydrateCookies()
        if observeLifecycle {
            observer = NotificationCenter.default.addObserver(forName:UIApplication.didBecomeActiveNotification,object:nil,queue:.main) { [weak self] _ in
                Task { @MainActor in self?.setForeground(true) }
            }
            backgroundObserver = NotificationCenter.default.addObserver(forName:UIApplication.didEnterBackgroundNotification,object:nil,queue:.main) { [weak self] _ in
                Task { @MainActor in
                    // Persist the newest fragment state before the app is suspended.
                    self?.flushSaves(); self?.setForeground(false)
                }
            }
        }
        startup = Task { await reconnect() }
        if observeLifecycle {
            progressTimer = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for:.seconds(1))
                    guard !Task.isCancelled, let self else { return }
                    if self.foreground && self.jobs.contains(where: { $0.state == "downloading" }) { self.publish() }
                }
            }
        }
    }
    // Use a foreground session while the user watches progress. Handoff restarts
    // only unfinished HLS fragments; whole MP4s stay in the background session.
    func setForeground(_ value: Bool) {
        foreground = value
        for job in jobs where job.state == "downloading" { activity[job.id] = DownloadActivity(at:ProcessInfo.processInfo.systemUptime) }
        for (name,task) in Array(transfers) {
            guard foregroundTransfers.contains(name) != value,
                  !finalization.pending.contains(name), let (j,p) = indices(name),
                  restartable(jobs[j]), !jobs[j].parts[p].finished else { continue }
            transfers.removeValue(forKey:name); foregroundTransfers.remove(name)
            task.cancel() // Identity checks ignore late callbacks from retired tasks.
            jobs[j].parts[p].received = 0; jobs[j].parts[p].expected = 0
        }
        schedule(); publish()
    }
    // Work that can be restarted from scratch may switch sessions; a whole-file MP4
    // cannot, because leaving the background session loses its partial progress.
    private func restartable(_ job: DownloadJob) -> Bool {
        job.candidate.kind == "hls" || job.parts.contains { $0.source.range != nil }
    }
    func close() {
        progressTimer?.cancel()
        if let observer { NotificationCenter.default.removeObserver(observer) }
        if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
        foregroundSession.invalidateAndCancel(); session.invalidateAndCancel()
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
                // Re-hashing every saved fragment on the main actor stalls launch on
                // long playlists. Move the check to a background pass; any mismatch
                // still fails the job, and no part starts before the plan is saved.
                let pending = jobs[j].parts.filter { $0.finished && $0.sha256 != nil }
                if !pending.isEmpty {
                    let id = jobs[j].id
                    let checks = pending.map { ($0.file,$0.sha256 ?? "") }
                    Self.verifyQueue.async {
                        let bad = checks.contains { check in
                            (try? Self.hash(directory.appendingPathComponent(check.0))) != check.1
                        }
                        guard bad else { return }
                        Task { @MainActor in
                            guard let current = self.jobs.firstIndex(where: { $0.id == id }), !["complete","cancelled"].contains(self.jobs[current].state) else { return }
                            self.jobs[current].state = "failed"
                            self.jobs[current].message = "恢复校验失败，旧数据已保留；请取消后重新下载"
                            self.suspend(id); self.persist(); self.publish()
                        }
                    }
                }
                if jobs[j].candidate.kind == "hls", jobs[j].parts.contains(where: \.finished), !jobs[j].parts.allSatisfy(\.finished), jobs[j].state != "paused" {
                    // A process restart may outlive the playlist's authorization. Do not append
                    // newly fetched bytes to saved fragments before revalidating the full plan.
                    jobs[j].state = "paused"
                    jobs[j].message = "已恢复分片；点击继续以校验资源和密钥是否仍一致"
                }
            } catch { jobs[j].state = "failed"; jobs[j].message = "恢复校验失败，旧数据已保留；请取消后重新下载"; suspend(jobs[j].id) }
        }
        ready = true; persist(); setForeground(foreground)
    }
    func add(_ candidate: MediaCandidate, parts: [DownloadPart], mode: OutputMode = .mp4, deep: Bool = false) throws {
        guard storageError == nil else { throw HarborError.message(storageError!) }
        guard !parts.isEmpty else { throw HarborError.message("没有可下载的媒体分片") }
        var job = DownloadJob(candidate:candidate,parts:parts)
        job.outputMode = mode; job.deepVerify = deep
        _ = try store.directory(job.id)
        jobs.append(job)
        do { try store.save(jobs) } catch { jobs.removeLast(); throw HarborError.message("无法保存任务，下载未开始") }
        hydrateCookies()
        publish(); schedule()
    }
    func control(_ id: String, action: String, mode: OutputMode? = nil) async throws {
        guard var j = jobs.firstIndex(where: { $0.id == id }) else { throw HarborError.message("任务不存在") }
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
                guard let current = jobs.firstIndex(where: { $0.id == id }) else { throw HarborError.message("任务已删除") }
                j = current
                guard jobs[j].state == old.state else { throw HarborError.message("任务状态已改变，请重试") }
                guard fresh.count == old.parts.count, zip(fresh,old.parts).allSatisfy({ pair in pair.0.source == pair.1.source && pair.0.key == pair.1.key }) else { throw HarborError.message("资源已变化，无法安全续传。旧数据保留，请取消后重新解析下载") }
            }
            try JobRetry.queue(id,mode:mode,jobs:&jobs,save:store.save)
            publish(); schedule(); return
        case "cancel":
            guard !["complete","processing","cancelled"].contains(jobs[j].state) else { throw HarborError.message("此阶段不能取消") }
            let names = transfers.keys.filter { $0.hasPrefix(id + ":") }
            for name in names { transfers.removeValue(forKey:name)?.cancel(); foregroundTransfers.remove(name) }
            let directory = try store.directory(id)
            try FileManager.default.removeItem(at:directory)
            jobs[j].state = "cancelled"; jobs[j].message = "已取消，临时数据已删除"; scrub(j)
        default: throw HarborError.message("不支持的任务操作")
        }
        try store.save(jobs); publish(); schedule()
    }
    func output(_ id: String) throws -> URL {
        guard let job = jobs.first(where:{$0.id == id}), job.state == "complete", let filename = job.output,
              filename == id + "." + job.mode.fileExtension else { throw HarborError.message("视频尚未完成") }
        let path = try FileManager.default.url(for:.documentDirectory,in:.userDomainMask,appropriateFor:nil,create:true).appendingPathComponent(filename)
        guard FileManager.default.fileExists(atPath:path.path) else { throw HarborError.message("视频文件已被移动或删除") }
        return path
    }
    func deleteRecord(_ id: String) throws {
        guard let job = jobs.first(where: { $0.id == id }) else { return }
        guard ["complete","cancelled"].contains(job.state) else { throw HarborError.message("请先取消任务，再删除记录") }
        guard !transfers.keys.contains(where: { $0.hasPrefix(id + ":") }) else { throw HarborError.message("后台任务正在结束，请稍后重试") }
        // Commit first: failed writes leave the visible queue unchanged. Output is untouched.
        try RecordHistory.delete(id,from:&jobs,save:store.save)
        publish()
    }
    private func suspend(_ id: String) {
        activity.removeValue(forKey:id)
        for (name,task) in transfers where name.hasPrefix(id + ":") { task.suspend() }
    }
    private func schedule(persistChanges: Bool = false) {
        guard ready, storageError == nil else { return }
        var needsSave = persistChanges
        var created: [(String,URLSessionDownloadTask)] = []
        var active = jobs.filter { $0.state == "downloading" }.count
        for j in jobs.indices {
            if jobs[j].state == "queued", active < DownloadScheduling.activeJobs { jobs[j].state = "downloading"; active += 1; needsSave = true }
            guard jobs[j].state == "downloading" else { continue }
            if jobs[j].parts.allSatisfy(\.finished) { jobs[j].state = "waitingForeground"; jobs[j].message = "下载完成，回到前台后合并"; active -= 1; needsSave = true; continue }
            let id = jobs[j].id
            if activity[id] == nil { activity[id] = DownloadActivity(at:ProcessInfo.processInfo.systemUptime) }
            let prefix = id + ":"
            let occupied = Set(Set(transfers.keys).union(finalization.pending).filter { $0.hasPrefix(prefix) }.compactMap { Int($0.dropFirst(prefix.count)) })
            for p in DownloadScheduling.pendingIndices(jobs[j].parts,occupied:occupied) {
                let name = "\(id):\(p)"
                let part = jobs[j].parts[p]
                jobs[j].parts[p].received = 0; jobs[j].parts[p].expected = 0
                var req = jobs[j].candidate.context.request(part.source.url,range:part.source.range)
                req.setValue(nil,forHTTPHeaderField:"Cookie")
                let useForeground = foreground && restartable(jobs[j])
                let task = (useForeground ? foregroundSession : session).downloadTask(with:req); task.taskDescription = name
                if useForeground { foregroundTransfers.insert(name) }
                transfers[name] = task; created.append((name,task))
            }
        }
        // add/retry persist the entire source/key/destination plan. Only state
        // transitions need another save here, once per batch, before resuming.
        if needsSave && !persist() {
            for (name,task) in created { transfers.removeValue(forKey:name); foregroundTransfers.remove(name); task.cancel() }
            publish(); return
        }
        for (name,task) in transfers where task.state == .suspended {
            if let (j,_) = indices(name), jobs[j].state == "downloading" { task.resume() }
        }
        if needsSave { publish() }
        if UIApplication.shared.applicationState == .active && !processing,
           let j = jobs.firstIndex(where:{$0.state == "waitingForeground"}) { merge(j) }
    }
    private func indices(_ name: String) -> (Int,Int)? {
        let bits = name.split(separator:":")
        guard bits.count == 2, let j = jobs.firstIndex(where:{$0.id == String(bits[0])}), let p = Int(bits[1]), jobs[j].parts.indices.contains(p) else { return nil }
        return (j,p)
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let name = downloadTask.taskDescription, transfers[name] === downloadTask,
              let (j,p) = indices(name), jobs[j].state == "downloading" else { return }
        let delta = max(0,totalBytesWritten - jobs[j].parts[p].received)
        activity[jobs[j].id]?.receive(delta,at:ProcessInfo.processInfo.systemUptime)
        jobs[j].parts[p].received = totalBytesWritten
        jobs[j].parts[p].expected = jobs[j].parts[p].source.range?.length ?? totalBytesExpectedToWrite
        if jobs[j].candidate.kind == "hls", totalBytesWritten > 256*1024*1024 {
            jobs[j].state = "failed"; jobs[j].message = "单个 HLS 分片超过 256 MiB"; suspend(jobs[j].id); downloadTask.cancel(); persist(); publish(); return
        }
        if progressThrottle.shouldPublish(at:ProcessInfo.processInfo.systemUptime) { publish() }
    }
    // Replace parallel MP4 byte-range parts with one full-file part. Chunks already
    // saved are unusable on their own, so the whole-file request starts from zero;
    // nothing reaches the output until merge, so this only costs the transferred bytes.
    private func degradeMP4(_ j: Int, reason: String) -> Bool {
        guard jobs[j].candidate.kind == "mp4", jobs[j].parts.count > 1 else { return false }
        let id = jobs[j].id
        jobs[j].planGeneration = (jobs[j].planGeneration ?? 0) + 1
        jobs[j].parts = [DownloadPart(source:Part(url:jobs[j].candidate.url),track:0,index:0)]
        jobs[j].message = "\(reason)，已改为整文件下载"
        let prefix = id + ":"
        for (name,task) in Array(transfers) where name.hasPrefix(prefix) {
            transfers.removeValue(forKey:name); foregroundTransfers.remove(name); task.cancel()
        }
        if let directory = try? store.directory(id),
           let files = try? FileManager.default.contentsOfDirectory(atPath:directory.path) {
            for file in files where file.hasSuffix(".part") || file.hasSuffix(".plain") {
                try? FileManager.default.removeItem(at:directory.appendingPathComponent(file))
            }
        }
        // Late cancel callbacks are dropped by the transfers identity check above.
        persist(); publish(); schedule()
        return true
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let name = downloadTask.taskDescription, transfers[name] === downloadTask,
              let (j,p) = indices(name), !["cancelled","failed"].contains(jobs[j].state) else { return }
        do {
            guard let response = downloadTask.response as? HTTPURLResponse else { throw HarborError.message("媒体响应无效") }
            guard (200...299).contains(response.statusCode) else {
                let part = jobs[j].parts[p]
                let resource = jobs[j].candidate.kind == "mp4" ? "MP4" : part.source.isMap ? "HLS 初始化片段" : "HLS 分片 \(part.index + 1)"
                throw HarborError.http(response.statusCode,resource,response.url?.host ?? part.source.url.host ?? "媒体服务器")
            }
            let size = try FileManager.default.attributesOfItem(atPath:location.path)[.size] as? NSNumber
            guard let bytes = size?.int64Value, bytes > 0 else { throw HarborError.message("服务器返回空文件") }
            if let range = jobs[j].parts[p].source.range {
                guard response.statusCode == 206, bytes == range.length,
                      response.value(forHTTPHeaderField:"Content-Range")?.hasPrefix("bytes \(range.offset)-\(range.offset + range.length - 1)/") == true else {
                    // A server that advertised Range but returned something else must not
                    // cost the user the whole job: fall back to one full-file request.
                    if jobs[j].candidate.kind == "mp4", jobs[j].parts.count > 1, degradeMP4(j, reason:"服务器未按字节范围返回") { return }
                    throw HarborError.message("服务器返回的字节范围不一致，拒绝合并")
                }
            } else {
                guard response.statusCode == 200 else { throw HarborError.message("服务器返回非完整媒体，拒绝保存") }
            }
            if jobs[j].candidate.kind == "hls", bytes > 256*1024*1024 { throw HarborError.message("单个 HLS 分片超过 256 MiB") }
            let target = try store.directory(jobs[j].id).appendingPathComponent(jobs[j].parts[p].file)
            if FileManager.default.fileExists(atPath:target.path) { try FileManager.default.removeItem(at:target) }
            try FileManager.default.moveItem(at:location,to:target)
            try FileManager.default.setAttributes([.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication],ofItemAtPath:target.path)
            let validator = response.value(forHTTPHeaderField:"ETag") ?? response.value(forHTTPHeaderField:"Last-Modified")
            let generation = jobs[j].planGeneration ?? 0
            let targetName = target.lastPathComponent
            finalization.begin(name)
            Task { @MainActor in
                let jobID = String(name.split(separator:":").first ?? "")
                do {
                    let digest: String = try await withCheckedThrowingContinuation { continuation in
                        hashQueue.async {
                            continuation.resume(with:Result { try Self.hash(target) })
                        }
                    }
                    // Cancellation can delete files/records while the hash is running.
                    // Re-find by id; a paused/failed job may retain a completed part.
                    // A replaced plan (generation mismatch) must not receive these bytes.
                    if let (current,part) = indices(name), jobs[current].state != "cancelled",
                       jobs[current].planGeneration ?? 0 == generation,
                       jobs[current].parts[part].file == targetName {
                        jobs[current].parts[part].sha256 = digest
                        jobs[current].parts[part].validator = validator
                        jobs[current].parts[part].finished = true
                        jobs[current].parts[part].received = bytes; jobs[current].parts[part].expected = bytes
                        persistSoon(); publish()
                    } else {
                        // The plan moved on. Never remove a file the current plan still
                        // uses: a fallback plan reuses slot names such as 0-0.part, and
                        // deleting it here would destroy the replacement download.
                        let inUse = jobs.first(where: { $0.id == jobID })?.parts.contains { $0.file == targetName } ?? false
                        if !inUse { try? FileManager.default.removeItem(at:target) }
                    }
                } catch {
                    // Only the current plan may fail the job; a retired plan's late
                    // error (its temporary file was cleaned up) is not a real failure.
                    if generation == (jobs.first(where: { $0.id == jobID })?.planGeneration ?? 0),
                       let (current,_) = indices(name), jobs[current].state != "cancelled" {
                        jobs[current].state = "failed"; jobs[current].message = Self.safeError(error)
                        suspend(jobs[current].id); persist(); publish()
                    }
                }
                finalization.end(name)
                schedule()
                finishBackgroundEventsIfReady()
            }
        } catch {
            jobs[j].state = "failed"; jobs[j].message = Self.safeError(error); suspend(jobs[j].id); persist(); publish()
        }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let name = task.taskDescription, transfers[name] === task else { return }
        transfers.removeValue(forKey:name)
        foregroundTransfers.remove(name)
        var needsSave = false
        if let (j,p) = indices(name), let error, jobs[j].state == "downloading", !jobs[j].parts[p].finished, !finalization.pending.contains(name) {
            jobs[j].parts[p].retries += 1
            needsSave = true
            if jobs[j].parts[p].retries > 2 {
                let host = jobs[j].parts[p].source.url.host ?? "媒体服务器"
                let resource = jobs[j].candidate.kind == "mp4" ? "MP4" : "分片 \(p + 1)"
                jobs[j].state = "failed"; jobs[j].message = "\(resource)下载失败（\(host)，网络错误 \((error as NSError).code)）；临时数据保留，可重试"; suspend(jobs[j].id)
            }
            // Never expose signed URLs embedded in NSError descriptions.
        }
        schedule(persistChanges:needsSave)
    }
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        finalization.finishEvents()
        schedule()
        finishBackgroundEventsIfReady()
    }
    private func finishBackgroundEventsIfReady() {
        guard finalization.takeCompletion(hasHandler:backgroundCompletion != nil) else { return }
        // A coalesced snapshot may still be in flight; the system may suspend us as
        // soon as this handler returns, so force the newest state to disk first.
        flushSaves()
        let callback = backgroundCompletion; backgroundCompletion = nil; callback?()
    }
    private func merge(_ index: Int) {
        processing = true; jobs[index].state = "processing"; jobs[index].message = jobs[index].mode == .transcode ? "正在转码 H.264/AAC，请保持应用在前台" : "正在无损封装 \(jobs[index].mode.fileExtension.uppercased())，请保持应用在前台"
        guard persist() else { processing = false; return }; publish()
        let job = jobs[index]
        do {
            let directory = try store.directory(job.id)
            let docs = try FileManager.default.url(for:.documentDirectory,in:.userDomainMask,appropriateFor:nil,create:true)
            let output = docs.appendingPathComponent(job.id + "." + job.mode.fileExtension)
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
        let temporary = directory.appendingPathComponent("result." + job.mode.fileExtension)
        if FileManager.default.fileExists(atPath:temporary.path) { try FileManager.default.removeItem(at:temporary) }
        var inputs: [URL] = []
        for track in Set(job.parts.map(\.track)).sorted() {
            let parts = job.parts.filter { $0.track == track }.sorted { $0.index < $1.index }
            if job.candidate.kind == "mp4" {
                // Range chunks are consecutive bytes of one object; concatenating in
                // index order restores the original file without re-encoding.
                if parts.count == 1 { inputs.append(directory.appendingPathComponent(parts[0].file)) }
                else {
                    // Every chunk must agree on one object identity; serves can rotate
                    // bytes between requests even when the URL is unchanged.
                    let validators = Set(parts.compactMap(\.validator))
                    guard validators.count <= 1 else { throw HarborError.message("MP4 分段来自不同版本，拒绝合并；请取消后重新下载") }
                    let joined = directory.appendingPathComponent("joined-\(track).mp4")
                    if FileManager.default.fileExists(atPath:joined.path) { try FileManager.default.removeItem(at:joined) }
                    FileManager.default.createFile(atPath:joined.path,contents:nil)
                    guard let handle = FileHandle(forWritingAtPath:joined.path) else { throw HarborError.message("无法写入合并文件，请检查手机可用空间") }
                    do {
                        for part in parts {
                            let source = directory.appendingPathComponent(part.file)
                            // Hash while copying so each chunk is read once instead of twice.
                            let input = try FileHandle(forReadingFrom:source)
                            defer { try? input.close() }
                            var sha = SHA256(), written: Int64 = 0
                            while let block = try input.read(upToCount:1024*1024), !block.isEmpty {
                                sha.update(data:block); try handle.write(contentsOf:block); written += Int64(block.count)
                            }
                            if let expected = part.sha256, sha.finalize().map({ String(format:"%02x",$0) }).joined() != expected {
                                throw HarborError.message("MP4 分段校验失败，拒绝合并")
                            }
                            let declared = part.source.range?.length ?? written
                            guard written == declared else { throw HarborError.message("MP4 分段长度不一致，拒绝合并") }
                        }
                        try handle.close()
                    } catch { try? handle.close(); throw error }
                    inputs.append(joined)
                }
                continue
            }
            var entries: [(Part,String)] = []
            for part in parts {
                let original = directory.appendingPathComponent(part.file)
                guard let expected = part.sha256, try hash(original) == expected else { throw HarborError.message("分片校验失败，拒绝合并") }
                let plain = directory.appendingPathComponent(part.file + ".plain")
                if FileManager.default.fileExists(atPath:plain.path) { try FileManager.default.removeItem(at:plain) }
                if let encryption = part.source.encryption, let key = part.key {
                    let data = try NativeMedia.decrypt(Data(contentsOf:original,options:.mappedIfSafe),key:key,iv:encryption.iv)
                    try data.write(to:plain,options:.completeFileProtectionUntilFirstUserAuthentication)
                } else { try FileManager.default.linkItem(at:original,to:plain) }
                entries.append((part.source,plain.lastPathComponent))
            }
            let epochs = HLS.localEpochs(entries)
            var files: [(String,Double)] = []
            for (epoch,items) in epochs.enumerated() {
                let input = directory.appendingPathComponent("track-\(track)-epoch-\(epoch).m3u8")
                try HLS.localPlaylist(items).write(to:input,atomically:true,encoding:.utf8)
                files.append((input.lastPathComponent,items.reduce(0) { $0 + ($1.0.isMap ? 0 : $1.0.duration) }))
            }
            if files.count == 1 { inputs.append(directory.appendingPathComponent(files[0].0)) }
            else {
                guard files.allSatisfy({ $0.1 > 0 && $0.1.isFinite }) else { throw HarborError.message("不连续片段缺少有效时长，无法安全合并") }
                let input = directory.appendingPathComponent("track-\(track).ffconcat")
                try HLS.localConcat(files).write(to:input,atomically:true,encoding:.utf8)
                inputs.append(input)
            }
        }
        try NativeMedia.remux(video:inputs[0],audio:inputs.count > 1 ? inputs[1] : nil,output:temporary,mode:job.mode,deep:job.deepVerify ?? true)
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
        // Drop any pending coalesced snapshot: this call writes the newest state.
        pendingSave = false
        return write(jobs)
    }
    private func write(_ snapshot: [DownloadJob]) -> Bool {
        var failure: Error?
        saveQueue.sync {
            do { try store.save(snapshot) } catch { failure = error }
        }
        if failure != nil {
            storageError = "任务记录无法保存，请检查手机可用空间后重新打开应用"
            for task in transfers.values { task.suspend() }
            return false
        }
        return true
    }
    // Fragment completions can arrive several at a time. Coalesce them into one
    // snapshot and encrypt/write off the main actor, so the URLSession delegate
    // queue keeps scheduling instead of blocking on AES + JSON per fragment.
    private func persistSoon() {
        pendingSave = true
        drainSaves()
    }
    private func drainSaves() {
        guard pendingSave, !saveInFlight else { return }
        pendingSave = false; saveInFlight = true
        let snapshot = jobs, store = self.store
        saveQueue.async { [weak self] in
            var failure = false
            do { try store.save(snapshot) } catch { failure = true }
            Task { @MainActor in
                guard let self else { return }
                self.saveInFlight = false
                if failure {
                    self.storageError = "任务记录无法保存，请检查手机可用空间后重新打开应用"
                    for task in self.transfers.values { task.suspend() }
                }
                self.drainSaves() // write again only if state changed while saving
            }
        }
    }
    // Call before releasing an OS background completion handler or when the app is
    // about to be suspended: a coalesced snapshot must reach disk synchronously.
    private func flushSaves() {
        guard pendingSave || saveInFlight else { return }
        persist()
    }
    private func publish() {
        for j in jobs.indices where jobs[j].state == "downloading" {
            let bytes = jobs[j].parts.reduce(Int64(0)) { $0 + $1.received }
            let now = ProcessInfo.processInfo.systemUptime, sample = activity[jobs[j].id]
            let received = String(format:"%.1f",Double(bytes) / 1024 / 1024)
            let rate = String(format:"%.0f",(sample?.bytesPerSecond(at:now) ?? 0) / 1024)
            let idle = sample?.idleSeconds(at:now) ?? 0
            let detail = idle >= 30 ? "\(idle) 秒未收到数据，等待服务器或系统调度" : "\(rate) KiB/s"
            jobs[j].message = (jobs[j].candidate.kind == "hls" ? "已完成 \(jobs[j].parts.filter(\.finished).count) / \(jobs[j].parts.count) 个分片 · " : "") + "已接收 \(received) MiB · \(detail)"
        }
        changed?(jobs.map(\.publicValue))
    }
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
