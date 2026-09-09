import XCTest
@testable import HarborCore

final class HLSTests: XCTestCase {
    let base = URL(string:"https://example.test/video/index.m3u8")!
    func testVariantsAndAudio() throws {
        let p = try HLS.parse("#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",NAME=\"中文,原声\",DEFAULT=YES,URI=\"audio.m3u8\"\n#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS=\"avc1.640028,mp4a.40.2\",AUDIO=\"a\"\n720.m3u8",base:base)
        XCTAssertEqual(p.variants.count,1); XCTAssertEqual(p.audio.first?.name,"中文,原声"); XCTAssertEqual(p.variants.first?.audioGroup,"a")
    }
    func testMapRangeAndSequenceIV() throws {
        let p = try HLS.parse("#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:257\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXT-X-KEY:METHOD=AES-128,URI=\"key\"\n#EXT-X-BYTERANGE:32@0\n#EXTINF:5,\ndata.ts\n#EXT-X-BYTERANGE:32\n#EXTINF:5,\ndata.ts\n#EXT-X-ENDLIST",base:base)
        XCTAssertEqual(p.parts.count,3); XCTAssertNil(p.parts[0].encryption)
        XCTAssertEqual(p.parts[1].encryption?.iv.suffix(2),Data([1,1]))
        XCTAssertEqual(p.parts[2].range,ByteRange(offset:32,length:32))
    }
    func testRejectUnsafeInputs() throws {
        for text in ["#EXTM3U\n#EXTINF:4,\na.ts", "#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"key\"\na.ts\n#EXT-X-ENDLIST", "#EXTM3U\n#EXT-X-BYTERANGE:4\na.ts\n#EXT-X-ENDLIST", "#EXTM3U\nfile:///private/a\n#EXT-X-ENDLIST"] { XCTAssertThrowsError(try HLS.parse(text,base:base)) }
    }
    func testCookieIsolation() {
        let c = WebCookie(name:"session",value:"secret",domain:".example.test",path:"/video",secure:true,expires:nil)
        XCTAssertTrue(c.matches(base)); XCTAssertFalse(c.matches(URL(string:"https://evil-example.test/video")!))
        XCTAssertFalse(c.matches(URL(string:"https://example.test/videos")!)); XCTAssertFalse(c.matches(URL(string:"http://example.test/video")!))
    }
    func testExplicitIVAndKeyRotation() throws {
        let p = try HLS.parse("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"a\",IV=0x1\na.ts\n#EXT-X-KEY:METHOD=AES-128,URI=\"b\",IV=0x2\nb.ts\n#EXT-X-ENDLIST",base:base)
        XCTAssertNotEqual(p.parts[0].encryption,p.parts[1].encryption)
        XCTAssertEqual(p.parts[1].encryption?.iv.last,2)
    }
    func testRejectNonFiniteDurationAndRangeOverflow() {
        for tag in ["#EXTINF:nan,", "#EXTINF:1e100,", "#EXT-X-BYTERANGE:9@9223372036854775806"] {
            XCTAssertThrowsError(try HLS.parse("#EXTM3U\n\(tag)\na.ts\n#EXT-X-ENDLIST",base:base))
        }
    }
    func testSameURINewKeyDeclarationGetsNewGeneration() throws {
        let p = try HLS.parse("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key\",IV=0x1\na.ts\n#EXT-X-KEY:METHOD=AES-128,URI=\"key\",IV=0x1\nb.ts\n#EXT-X-ENDLIST",base:base)
        XCTAssertNotEqual(p.parts[0].encryption?.generation,p.parts[1].encryption?.generation)
    }
}
