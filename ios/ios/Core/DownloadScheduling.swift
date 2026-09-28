import Foundation

enum DownloadScheduling {
    static let activeJobs = 2
    static let connectionsPerHost = 6
    // Submitted tasks are a queue, not simultaneous connections. Keep enough work
    // in the background daemon to avoid waking the app for every few segments.
    static let batchSize = 24
    static let refillThreshold = 8
    // A plain MP4 has no segment list, so one URLSession task would hold a single
    // connection and leave the other per-host slots idle. Plan it as byte ranges
    // instead, but only when the server proves Range support (206 + total length).
    static let mp4ChunkSize: Int64 = 8 * 1024 * 1024
    static let mp4MinSize: Int64 = 16 * 1024 * 1024

    static func pendingIndices(_ parts: [DownloadPart], occupied: Set<Int>) -> [Int] {
        guard occupied.count < refillThreshold else { return [] }
        let capacity = max(0, batchSize - occupied.count)
        return Array(parts.indices.lazy.filter { !parts[$0].finished && !occupied.contains($0) }.prefix(capacity))
    }

    // Returns nil when the object should stay a single full-file request.
    static func mp4Chunks(totalLength: Int64, acceptsRanges: Bool) -> [ByteRange]? {
        // Bound first: keeps totalLength + mp4ChunkSize - 1 far from overflow.
        guard acceptsRanges, totalLength >= mp4MinSize, totalLength <= mp4ChunkSize * 4096 else { return nil }
        let count = Int((totalLength + mp4ChunkSize - 1) / mp4ChunkSize)
        guard count > 1 else { return nil }
        return (0..<count).map { index in
            let offset = Int64(index) * mp4ChunkSize
            return ByteRange(offset:offset,length:min(mp4ChunkSize,totalLength - offset))
        }
    }
}

struct DownloadProgressThrottle {
    private var last: TimeInterval?
    mutating func shouldPublish(at time: TimeInterval) -> Bool {
        guard last == nil || time - last! >= 0.25 else { return false }
        last = time
        return true
    }
}

struct DownloadActivity {
    private let started: TimeInterval
    private var lastData: TimeInterval
    private var bytes: Int64 = 0
    init(at time: TimeInterval) { started = time; lastData = time }
    mutating func receive(_ count: Int64, at time: TimeInterval) {
        guard count > 0 else { return }
        bytes += count; lastData = time
    }
    func bytesPerSecond(at time: TimeInterval) -> Double { Double(bytes) / max(1,time - started) }
    func idleSeconds(at time: TimeInterval) -> Int { max(0,Int(time - lastData)) }
}

// URLSession may finish delivering events while off-main file hashes are still
// running. Do not release the OS background completion handler before both finish.
struct DownloadFinalizationGate {
    private(set) var pending = Set<String>()
    private var eventsFinished = false
    mutating func begin(_ name: String) { pending.insert(name) }
    mutating func end(_ name: String) { pending.remove(name) }
    mutating func finishEvents() { eventsFinished = true }
    mutating func takeCompletion(hasHandler: Bool) -> Bool {
        guard hasHandler, eventsFinished, pending.isEmpty else { return false }
        eventsFinished = false
        return true
    }
}
