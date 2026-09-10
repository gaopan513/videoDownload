import Foundation

enum NativeMedia {
    static func decrypt(_ data: Data, key: Data, iv: Data) throws -> Data {
        guard key.count == 16, iv.count == 16, !data.isEmpty, data.count % 16 == 0 else { throw HarborError.message("AES 分片或密钥无效") }
        var output = Data(count:data.count), written = 0
        let size = data.count
        let code = output.withUnsafeMutableBytes { out in data.withUnsafeBytes { bytes in key.withUnsafeBytes { k in iv.withUnsafeBytes { v in
            harbor_decrypt(bytes.bindMemory(to:UInt8.self).baseAddress!,size,k.bindMemory(to:UInt8.self).baseAddress!,v.bindMemory(to:UInt8.self).baseAddress!,out.bindMemory(to:UInt8.self).baseAddress!,&written)
        } } } }
        guard code == 0 else { throw HarborError.message("AES 解密失败，请重新解析资源") }
        return output.prefix(written)
    }
    static func probe(_ path: URL, video: Bool, audio: Bool) -> Int32 { path.path.withCString { harbor_probe($0,video ? 1 : 0,audio ? 1 : 0) } }
    static func probe(_ path: URL, video: Bool, audio: Bool, mode: OutputMode) -> Int32 { path.path.withCString { harbor_probe_mode($0,video ? 1 : 0,audio ? 1 : 0,mode.nativeValue) } }
    static func codecs(_ path: URL) -> String {
        var text = [CChar](repeating:0,count:512)
        path.path.withCString { harbor_codecs($0,&text,512) }
        return String(cString:text)
    }
    static func remux(video: URL, audio: URL?, output: URL, mode: OutputMode = .mp4, deep: Bool = true) throws {
        let expected = video.path.withCString { harbor_duration($0) }
        let code = video.path.withCString { v in (audio?.path ?? "").withCString { a in output.path.withCString { o in harbor_convert(v,a,o,mode.nativeValue) } } }
        guard code == 0 else { throw HarborError.message(code == -2 ? "此编码不能按所选方式处理，请选择无损 MKV 或转码 MP4" : code == -3 ? "当前设备无法启动 H.264 编码器，可先选择无损 MP4/MKV 保存" : "媒体处理失败，请检查分片完整性或更换输出方式；临时数据已保留") }
        guard probe(output,video:true,audio:audio != nil,mode:mode == .transcode ? .mp4 : mode) == 1 else { throw HarborError.message("输出媒体检查失败") }
        let actual = output.path.withCString { harbor_duration($0) }
        guard actual.isFinite, actual > 0, expected <= 0 || abs(actual - expected) <= max(2,expected * 0.02) else { throw HarborError.message("输出时长校验失败，临时数据保留") }
        if deep { guard output.path.withCString({ harbor_verify($0) }) == 0 else { throw HarborError.message("完整解码检查失败，临时数据保留") } }
    }
}
