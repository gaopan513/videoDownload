import XCTest
@testable import StreamHarbor

final class NativeTests: XCTestCase {
    var fixtures: URL { get throws { try XCTUnwrap(Bundle(for:NativeTests.self).url(forResource:"Fixtures",withExtension:nil)) } }
    func testAES128KnownVectorAndInvalidPadding() throws {
        // AES-128-CBC/PKCS7: independently generated fixture in scripts/ios-fixtures.mjs.
        let data = try Data(contentsOf:fixtures.appendingPathComponent("encrypted.bin"))
        let plain = try NativeMedia.decrypt(data,key:Data(repeating:7,count:16),iv:Data(repeating:3,count:16))
        XCTAssertEqual(String(data:plain,encoding:.utf8),"StreamHarbor AES test")
        XCTAssertThrowsError(try NativeMedia.decrypt(data,key:Data(repeating:8,count:16),iv:Data(repeating:3,count:16)))
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
}
