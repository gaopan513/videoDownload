import XCTest
import WebKit
import AVFoundation
import CryptoKit
@testable import StreamHarbor

final class NativeTests: XCTestCase {
    @MainActor func testHLSHandoffPreservesRangeAndRejectsRetiredCallbacks() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:directory) }
        let store = try SecureStore(root:directory,key:SymmetricKey(size:.bits256))
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [PendingMediaProtocol.self]
        let engine = try DownloadEngine(store:store,foregroundConfiguration:config,backgroundConfiguration:config,observeLifecycle:false)
        defer { engine.close() }
        await engine.startup?.value
        engine.setForeground(true)
        let url = URL(string:"https://fixture.test/segment.png?verify=private")!
        let candidate = MediaCandidate(title:"handoff",url:url,audioURL:nil,kind:"hls",quality:"",context:WebContext(referer:url,userAgent:"test",cookies:[]))
        try engine.add(candidate,parts:[DownloadPart(source:Part(url:url,range:ByteRange(offset:120,length:512),duration:6),track:0,index:0)])
        let name = try XCTUnwrap(engine.transfers.keys.first)
        let old = try XCTUnwrap(engine.transfers[name])
        XCTAssertEqual(old.originalRequest?.value(forHTTPHeaderField:"Range"),"bytes=120-631")
        let callbackSession = URLSession(configuration:config)
        defer { callbackSession.invalidateAndCancel() }
        engine.urlSession(callbackSession,downloadTask:old,didWriteData:128,totalBytesWritten:128,totalBytesExpectedToWrite:-1)
        XCTAssertEqual(engine.jobs[0].parts[0].expected,512)
        XCTAssertEqual(engine.jobs[0].publicValue["done"] as? Double,0.25)
        engine.setForeground(false)
        let background = try XCTUnwrap(engine.transfers[name])
        XCTAssertFalse(old === background)
        XCTAssertEqual(background.originalRequest?.value(forHTTPHeaderField:"Range"),"bytes=120-631")
        engine.urlSession(callbackSession,downloadTask:old,didWriteData:384,totalBytesWritten:512,totalBytesExpectedToWrite:512)
        engine.urlSession(callbackSession,task:old,didCompleteWithError:URLError(.cancelled))
        XCTAssertTrue(engine.transfers[name] === background)
        XCTAssertEqual(engine.jobs[0].parts[0].received,0)
        XCTAssertEqual(engine.jobs[0].parts[0].retries,0)
        engine.setForeground(true)
        let resumed = try XCTUnwrap(engine.transfers[name])
        XCTAssertFalse(resumed === background)
        try await engine.control(engine.jobs[0].id,action:"pause")
        engine.setForeground(false)
        XCTAssertTrue(engine.transfers.isEmpty)
        XCTAssertEqual(try store.load()[0].state,"paused")
        try await engine.control(engine.jobs[0].id,action:"cancel")
        XCTAssertEqual(try store.load()[0].state,"cancelled")
        XCTAssertTrue(engine.transfers.isEmpty)
    }
    @MainActor func testWholeMP4IsNotRestartedByForegroundHandoff() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:directory) }
        let store = try SecureStore(root:directory,key:SymmetricKey(size:.bits256))
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [PendingMediaProtocol.self]
        let engine = try DownloadEngine(store:store,foregroundConfiguration:config,backgroundConfiguration:config,observeLifecycle:false)
        defer { engine.close() }
        await engine.startup?.value
        let url = URL(string:"https://fixture.test/movie.mp4")!
        let candidate = MediaCandidate(title:"mp4",url:url,audioURL:nil,kind:"mp4",quality:"",context:WebContext(referer:url,userAgent:"test",cookies:[]))
        try engine.add(candidate,parts:[DownloadPart(source:Part(url:url),track:0,index:0)])
        let name = try XCTUnwrap(engine.transfers.keys.first), original = try XCTUnwrap(engine.transfers[name])
        engine.setForeground(false); engine.setForeground(true)
        XCTAssertTrue(engine.transfers[name] === original)
        try await engine.control(engine.jobs[0].id,action:"cancel")
    }
    func testZeroDeclaredDurationDoesNotDropTransportStream() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        defer { try? FileManager.default.removeItem(at:directory) }
        let source = try fixtures.appendingPathComponent("video.ts")
        try FileManager.default.copyItem(at:source,to:directory.appendingPathComponent("zero.plain"))
        let parsed = try HLS.parse("#EXTM3U\n#EXTINF:0,\nzero.ts\n#EXT-X-ENDLIST",base:URL(string:"https://fixture.test/index.m3u8")!)
        let input = directory.appendingPathComponent("zero.m3u8")
        try HLS.localPlaylist([(parsed.parts[0],"zero.plain")]).write(to:input,atomically:true,encoding:.utf8)
        let output = directory.appendingPathComponent("zero.mp4")
        try NativeMedia.remux(video:input,audio:nil,output:output,deep:true)
        XCTAssertEqual(output.path.withCString { harbor_duration($0) },2,accuracy:0.15)
    }
    func testLocalFragmentedMP4WithPlainNamesInAllOutputModes() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        defer { try? FileManager.default.removeItem(at:directory) }
        let source = try fixtures
        let playlist = try HLS.parse(String(contentsOf:source.appendingPathComponent("fmp4.m3u8"),encoding:.utf8),base:URL(string:"https://fixture.test/fmp4.m3u8")!)
        XCTAssertEqual(playlist.parts.filter(\.isMap).count,1)
        XCTAssertEqual(playlist.parts.filter { !$0.isMap }.count,2)
        var entries: [(Part,String)] = []
        for (index,part) in playlist.parts.enumerated() {
            let name = "\(index).plain"
            try FileManager.default.copyItem(at:source.appendingPathComponent(part.url.lastPathComponent),to:directory.appendingPathComponent(name))
            entries.append((part,name))
        }
        let input = directory.appendingPathComponent("local.m3u8")
        try HLS.localPlaylist(entries).write(to:input,atomically:true,encoding:.utf8)
        for mode: OutputMode in [.mp4,.mkv,.transcode] {
            let output = directory.appendingPathComponent("output-\(mode.nativeValue).\(mode.fileExtension)")
            try NativeMedia.remux(video:input,audio:nil,output:output,mode:mode,deep:true)
            XCTAssertEqual(NativeMedia.probe(output,video:true,audio:true,mode:mode == .transcode ? .mp4 : mode),1)
            XCTAssertEqual(output.path.withCString { harbor_duration($0) },2,accuracy:0.15)
        }
    }
    func testPreflightRejectsMissingSegmentInsteadOfUnknownCodec() async throws {
        let url = URL(string:"https://fixture.test/missing.png?secret=hidden")!
        let context = WebContext(referer:url,userAgent:"test",cookies:[])
        let http = HTTP(context)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [MissingMediaProtocol.self]
        http.session = URLSession(configuration:config)
        defer { http.close() }
        let candidate = MediaCandidate(title:"missing",url:url,audioURL:nil,kind:"hls",quality:"",context:context)
        do {
            _ = try await http.preflight(candidate,parts:[DownloadPart(source:Part(url:url,duration:3),track:0,index:0)])
            XCTFail("HTTP 404 must prevent queue admission")
        } catch let error as HarborError {
            guard case .http(let status,let resource,let host) = error else { return XCTFail("Expected HTTP error") }
            XCTAssertEqual(status,404); XCTAssertEqual(resource,"HLS 分片 1"); XCTAssertEqual(host,"fixture.test")
            XCTAssertFalse(error.localizedDescription.contains("secret"))
        }
    }
    func testRemuxDiscontinuousTransportStream() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        defer { try? FileManager.default.removeItem(at:directory) }
        let source = try fixtures.appendingPathComponent("video.ts")
        try FileManager.default.copyItem(at:source,to:directory.appendingPathComponent("a.plain"))
        try FileManager.default.copyItem(at:source,to:directory.appendingPathComponent("b.plain"))
        let a = Part(url:source,duration:2)
        let b = Part(url:source,duration:2,discontinuity:true)
        let epochs = HLS.localEpochs([(a,"a.plain"),(b,"b.plain")])
        var files: [(String,Double)] = []
        for (i,entries) in epochs.enumerated() {
            let name = "epoch-\(i).m3u8"
            try HLS.localPlaylist(entries).write(to:directory.appendingPathComponent(name),atomically:true,encoding:.utf8)
            files.append((name,entries.reduce(0) { $0 + $1.0.duration }))
        }
        let list = directory.appendingPathComponent("local.ffconcat")
        try HLS.localConcat(files).write(to:list,atomically:true,encoding:.utf8)
        let output = directory.appendingPathComponent("output.mp4")
        try NativeMedia.remux(video:list,audio:nil,output:output)
        XCTAssertEqual(NativeMedia.probe(output,video:true,audio:false),1)
        let duration = try await AVURLAsset(url:output).load(.duration)
        XCTAssertEqual(CMTimeGetSeconds(duration),4,accuracy:0.15)
    }
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
    func testDesktopMP4CodecMatrix() throws {
        for name in ["h264-aac.mp4","hevc-ac3.mp4","av1-eac3.mp4","mpeg4-mp3.mp4","h264-alac.mp4"] {
            let input = try fixtures.appendingPathComponent(name)
            let out = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mp4")
            defer { try? FileManager.default.removeItem(at:out) }
            XCTAssertEqual(NativeMedia.probe(input,video:true,audio:true),1,name)
            try NativeMedia.remux(video:input,audio:nil,output:out,deep:true)
            XCTAssertEqual(NativeMedia.codecs(out),NativeMedia.codecs(input),name)
            XCTAssertEqual(out.path.withCString { harbor_duration($0) },2,accuracy:0.15,name)
        }
    }
    func testMKVPreservesVP9OpusAndMP4RejectsIt() throws {
        let input = try fixtures.appendingPathComponent("vp9-opus.mkv")
        let out = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mkv")
        defer { try? FileManager.default.removeItem(at:out) }
        XCTAssertEqual(NativeMedia.probe(input,video:true,audio:true),-2)
        XCTAssertEqual(NativeMedia.probe(input,video:true,audio:true,mode:.mkv),1)
        try NativeMedia.remux(video:input,audio:nil,output:out,mode:.mkv,deep:true)
        XCTAssertEqual(NativeMedia.codecs(out),"video: vp9; audio: opus")
    }
    func testTranscodeVP9OpusToH264AAC() async throws {
        let input = try fixtures.appendingPathComponent("vp9-opus.mkv")
        let out = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mp4")
        defer { try? FileManager.default.removeItem(at:out) }
        try NativeMedia.remux(video:input,audio:nil,output:out,mode:.transcode,deep:true)
        XCTAssertEqual(NativeMedia.codecs(out),"video: h264; audio: aac")
        let asset = AVURLAsset(url:out)
        let tracks = try await asset.load(.tracks)
        XCTAssertEqual(tracks.count,2)
        var starts: [Double] = []
        for track in tracks {
            let time = try await track.load(.timeRange)
            starts.append(CMTimeGetSeconds(time.start))
            XCTAssertEqual(CMTimeGetSeconds(time.duration),2,accuracy:0.15)
        }
        XCTAssertLessThan(abs(starts[0] - starts[1]),0.1)
    }
    func testMPEG4IsNoLongerRejected() throws {
        XCTAssertEqual(NativeMedia.probe(try fixtures.appendingPathComponent("unsupported.mp4"),video:true,audio:false),1)
    }
    func testTranscodeTransportStreamWithSeparateAudio() throws {
        let directory = try fixtures
        let out = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mp4")
        defer { try? FileManager.default.removeItem(at:out) }
        try NativeMedia.remux(video:directory.appendingPathComponent("video.ts"),audio:directory.appendingPathComponent("audio.aac"),output:out,mode:.transcode,deep:true)
        XCTAssertEqual(NativeMedia.codecs(out),"video: h264; audio: aac")
        XCTAssertEqual(out.path.withCString { harbor_duration($0) },2,accuracy:0.15)
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

private final class PendingMediaProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {} // Hold until handoff/cancellation; no network.
    override func stopLoading() {}
}

private final class MissingMediaProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url:request.url!,statusCode:404,httpVersion:"HTTP/1.1",headerFields:[:])!
        client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
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
