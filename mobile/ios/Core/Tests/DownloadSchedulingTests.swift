import XCTest
@testable import HarborCore

final class DownloadSchedulingTests: XCTestCase {
    func testBackgroundCompletionWaitsForEventsHashesAndHandlerExactlyOnce() {
        var gate = DownloadFinalizationGate()
        gate.begin("job:0"); gate.begin("job:1")
        XCTAssertFalse(gate.takeCompletion(hasHandler:true))
        gate.finishEvents()
        XCTAssertFalse(gate.takeCompletion(hasHandler:true))
        gate.end("job:0")
        XCTAssertFalse(gate.takeCompletion(hasHandler:true))
        gate.end("job:1")
        XCTAssertFalse(gate.takeCompletion(hasHandler:false))
        XCTAssertTrue(gate.takeCompletion(hasHandler:true))
        XCTAssertFalse(gate.takeCompletion(hasHandler:true))
        // In the other callback order, hashes finish before the session's events.
        gate.begin("job:2"); gate.end("job:2")
        XCTAssertFalse(gate.takeCompletion(hasHandler:true))
        gate.finishEvents()
        XCTAssertTrue(gate.takeCompletion(hasHandler:true))
    }
    private func parts(_ count: Int) -> [DownloadPart] {
        (0..<count).map { DownloadPart(source:Part(url:URL(string:"https://fixture.test/\($0).ts")!,duration:2),track:0,index:$0) }
    }

    func testBatchRefillDoesNotDuplicateActiveOrVerifyingParts() {
        var items = parts(60)
        let first = DownloadScheduling.pendingIndices(items,occupied:[])
        XCTAssertEqual(first,Array(0..<24))
        // Eight outstanding requests/hashes keep the batch running without refill.
        for i in 0..<16 { items[i].finished = true }
        XCTAssertTrue(DownloadScheduling.pendingIndices(items,occupied:Set(16..<24)).isEmpty)
        items[16].finished = true
        let next = DownloadScheduling.pendingIndices(items,occupied:Set(17..<24))
        XCTAssertEqual(next,Array(24..<41))
        XCTAssertEqual(next.count + 7,DownloadScheduling.batchSize)
        // A failed part re-enters the next batch once its transfer/hash slot is gone.
        items[3].finished = false
        XCTAssertEqual(DownloadScheduling.pendingIndices(items,occupied:Set(17..<24)).first,3)
    }

    func testRestoredFinishedPartsAreSkippedAndTailDrains() {
        var items = parts(40)
        for i in 0..<35 { items[i].finished = true }
        XCTAssertEqual(DownloadScheduling.pendingIndices(items,occupied:[35,36]),[37,38,39])
        XCTAssertTrue(DownloadScheduling.pendingIndices(items,occupied:Set(35..<40)).isEmpty)
        for i in 35..<40 { items[i].finished = true }
        XCTAssertTrue(DownloadScheduling.pendingIndices(items,occupied:[]).isEmpty)
        XCTAssertTrue(DownloadScheduling.pendingIndices([],occupied:[]).isEmpty)
    }

    func testLongPlaylistCompletesWithoutDuplicateSubmission() {
        var items = parts(3000), active = Set<Int>(), submitted = Set<Int>()
        var batches = 0
        while !items.allSatisfy(\.finished) {
            let next = DownloadScheduling.pendingIndices(items,occupied:active)
            if !next.isEmpty { batches += 1 }
            for p in next { XCTAssertTrue(submitted.insert(p).inserted); active.insert(p) }
            XCTAssertLessThanOrEqual(active.count,DownloadScheduling.batchSize)
            guard let completed = active.min() else { return XCTFail("Queue stalled") }
            active.remove(completed); items[completed].finished = true
        }
        XCTAssertEqual(submitted.count,3000)
        XCTAssertLessThan(batches,180)
    }

    func testProgressCallbacksAreThrottledAndPartialBytesAreVisible() {
        var throttle = DownloadProgressThrottle(), emitted = 0
        for i in 0..<1000 { if throttle.shouldPublish(at:Double(i) / 1000) { emitted += 1 } }
        XCTAssertEqual(emitted,4)
        XCTAssertTrue(throttle.shouldPublish(at:2))
        let url = URL(string:"https://fixture.test/input.m3u8")!
        let candidate = MediaCandidate(title:"progress",url:url,audioURL:nil,kind:"hls",quality:"",context:WebContext(referer:url,userAgent:"test",cookies:[]))
        var job = DownloadJob(candidate:candidate,parts:parts(3))
        job.parts[0].finished = true
        job.parts[1].received = 50; job.parts[1].expected = 100
        job.parts[2].received = 100; job.parts[2].expected = -1
        XCTAssertEqual(job.publicValue["done"] as? Double,1.5)
        job.parts[1].received = 200
        XCTAssertEqual(job.publicValue["done"] as? Double,1.99)
        job.state = "complete"
        XCTAssertEqual(job.publicValue["done"] as? Double,1)
    }
}
