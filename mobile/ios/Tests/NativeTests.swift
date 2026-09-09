import XCTest
import WebKit
@testable import StreamHarbor

final class NativeTests: XCTestCase {
    @MainActor func testWebKitDiscoversSrcdocRequestAndExtensionlessVideo() async throws {
        let frame = expectation(description:"srcdoc HLS request"), video = expectation(description:"extensionless video")
        let receiver = MediaReceiver { info in
            if info["url"] == "https://fixture.test/movie.m3u8", info["kind"] == "hls" { frame.fulfill() }
            if info["url"] == "https://fixture.test/stream?id=1", info["kind"] == "unknown" { video.fulfill() }
        }
        let config = WKWebViewConfiguration()
        config.userContentController.add(receiver,name:"harborMedia")
        config.userContentController.addUserScript(WKUserScript(source:Resolver.script,injectionTime:.atDocumentStart,forMainFrameOnly:false))
        let web = WKWebView(frame:.zero,configuration:config)
        defer { web.stopLoading(); config.userContentController.removeScriptMessageHandler(forName:"harborMedia") }
        web.loadHTMLString(#"""
        <video src="https://fixture.test/stream?id=1" preload="none"></video>
        <iframe srcdoc="<script>new XMLHttpRequest().open('GET','https://fixture.test/movie.m3u8');</script>"></iframe>
        """#,baseURL:URL(string:"https://fixture.test/"))
        await fulfillment(of:[frame,video],timeout:15)
    }
    var fixtures: URL { get throws { try XCTUnwrap(Bundle(for:NativeTests.self).url(forResource:"Fixtures",withExtension:nil)) } }
    func testAES128KnownVectorAndInvalidPadding() throws {
        // AES-128-CBC/PKCS7: independently generated fixture in scripts/ios-fixtures.mjs.
        let data = try Data(contentsOf:fixtures.appendingPathComponent("encrypted.bin"))
        let plain = try NativeMedia.decrypt(data,key:Data(repeating:7,count:16),iv:Data(repeating:3,count:16))
        XCTAssertEqual(String(data:plain,encoding:.utf8),"StreamHarbor AES test")
        // CBC is unauthenticated: a wrong key can accidentally produce valid padding.
        // Flip the preceding ciphertext block's last byte to turn padding 0x0c into 0xff.
        XCTAssertEqual(data.count,32)
        var invalidPadding = data
        invalidPadding[invalidPadding.count - 17] ^= 0xf3
        XCTAssertThrowsError(try NativeMedia.decrypt(invalidPadding,key:Data(repeating:7,count:16),iv:Data(repeating:3,count:16)))
        invalidPadding = data
        invalidPadding[invalidPadding.count - 17] ^= 0x0c
        XCTAssertThrowsError(try NativeMedia.decrypt(invalidPadding,key:Data(repeating:7,count:16),iv:Data(repeating:3,count:16)))
        invalidPadding = data
        invalidPadding[invalidPadding.count - 18] ^= 1
        XCTAssertThrowsError(try NativeMedia.decrypt(invalidPadding,key:Data(repeating:7,count:16),iv:Data(repeating:3,count:16)))
    }
    func testRemuxTransportStreamAndSeparateAudio() throws {
        let directory = try fixtures
        let out = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mp4")
        defer { try? FileManager.default.removeItem(at:out) }
        try NativeMedia.remux(video:directory.appendingPathComponent("video.ts"),audio:directory.appendingPathComponent("audio.aac"),output:out)
        XCTAssertEqual(NativeMedia.probe(out,video:true,audio:true),1)
    }
    func testRejectNonH264() throws {
        XCTAssertEqual(NativeMedia.probe(try fixtures.appendingPathComponent("unsupported.mp4"),video:true,audio:false),-2)
    }
    func testEncryptedStateRoundTrip() throws {
        let store = try SecureStore()
        let before = try store.load()
        defer { try? store.save(before) }
        let u = URL(string:"https://example.test/video?token=do-not-store-plain")!
        let c = MediaCandidate(title:"测试",url:u,audioURL:nil,kind:"mp4",quality:"",context:WebContext(referer:u,userAgent:"test",cookies:[]))
        try store.save([DownloadJob(candidate:c,parts:[])])
        let bytes = try Data(contentsOf:store.root.appendingPathComponent("jobs.enc"))
        XCTAssertNil(bytes.range(of:Data("do-not-store-plain".utf8)))
        XCTAssertEqual(try store.load().first?.candidate.url,u)
    }
    func testDeleteHistoryPersistsAndKeepsOutput() throws {
        let store = try SecureStore(), before = try store.load()
        defer { try? store.save(before) }
        let u = URL(string:"https://example.test/video.mp4")!
        let c = MediaCandidate(title:"history",url:u,audioURL:nil,kind:"mp4",quality:"",context:WebContext(referer:u,userAgent:"test",cookies:[]))
        var complete = DownloadJob(candidate:c,parts:[]); complete.state = "complete"
        let output = FileManager.default.temporaryDirectory.appendingPathComponent(complete.id + ".mp4")
        complete.output = output.lastPathComponent
        try Data("retained video".utf8).write(to:output)
        defer { try? FileManager.default.removeItem(at:output) }
        let active = DownloadJob(candidate:c,parts:[])
        var jobs = [complete,active]
        try store.save(jobs)
        XCTAssertThrowsError(try RecordHistory.delete(complete.id,from:&jobs,save: { _ in throw HarborError.message("disk full") }))
        XCTAssertEqual(jobs.map(\.id),[complete.id,active.id])
        XCTAssertEqual(try store.load().map(\.id),[complete.id,active.id])
        XCTAssertThrowsError(try RecordHistory.delete(active.id,from:&jobs,save:store.save))
        try RecordHistory.delete(complete.id,from:&jobs,save:store.save)
        XCTAssertEqual(try SecureStore().load().map(\.id),[active.id])
        XCTAssertEqual(try Data(contentsOf:output),Data("retained video".utf8))
        try RecordHistory.delete(complete.id,from:&jobs,save:store.save)
        jobs[0].state = "cancelled"
        try RecordHistory.delete(active.id,from:&jobs,save:store.save)
        XCTAssertTrue(try store.load().isEmpty)
    }
}

private final class MediaReceiver: NSObject, WKScriptMessageHandler {
    let receive: ([String:String]) -> Void
    private var seen = Set<String>()
    init(_ receive: @escaping ([String:String]) -> Void) { self.receive = receive }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let info = message.body as? [String:String], let url = info["url"], seen.insert(url).inserted else { return }
        receive(info)
    }
}
