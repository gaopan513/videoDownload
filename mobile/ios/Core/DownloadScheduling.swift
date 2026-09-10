import Foundation

enum DownloadScheduling {
    static let activeJobs = 2
    static let connectionsPerHost = 6
    // Submitted tasks are a queue, not simultaneous connections. Keep enough work
    // in the background daemon to avoid waking the app for every few segments.
    static let batchSize = 24
    static let refillThreshold = 8

    static func pendingIndices(_ parts: [DownloadPart], occupied: Set<Int>) -> [Int] {
        guard occupied.count < refillThreshold else { return [] }
        let capacity = max(0, batchSize - occupied.count)
        return Array(parts.indices.lazy.filter { !parts[$0].finished && !occupied.contains($0) }.prefix(capacity))
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
