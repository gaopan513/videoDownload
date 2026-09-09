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
    static func remux(video: URL, audio: URL?, output: URL) throws {
        let code = video.path.withCString { v in (audio?.path ?? "").withCString { a in output.path.withCString { o in harbor_remux(v,a,o) } } }
        guard code == 0 else { throw HarborError.message(code == -2 ? "编码不兼容：原型仅支持 H.264/AAC，不提供转码" : "合并失败，分片或媒体时间戳无效；临时数据已保留") }
        guard probe(output,video:true,audio:audio != nil) == 1 else { throw HarborError.message("输出媒体检查失败") }
        guard output.path.withCString({ harbor_verify($0) }) == 0 else { throw HarborError.message("完整解码检查失败，未导出损坏视频") }
    }
}
