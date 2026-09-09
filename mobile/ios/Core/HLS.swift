import Foundation

enum HLS {
    static func attributes(_ value: String) throws -> [String: String] {
        var fields: [String] = [], current = "", quoted = false
        for char in value {
            if char == "\"" { quoted.toggle() }
            if char == "," && !quoted { fields.append(current); current = "" } else { current.append(char) }
        }
        guard !quoted else { throw HarborError.message("播放列表属性引号不完整") }
        fields.append(current)
        var result: [String: String] = [:]
        for field in fields {
            let pair = field.split(separator: "=", maxSplits: 1).map(String.init)
            guard pair.count == 2 else { continue }
            result[pair[0].trimmingCharacters(in: .whitespaces)] = pair[1].trimmingCharacters(in: CharacterSet(charactersIn: "\" "))
        }
        return result
    }
    static func iv(_ text: String?, sequence: UInt64) throws -> Data {
        if let text {
            let hex = text.lowercased().hasPrefix("0x") ? String(text.dropFirst(2)) : text
            guard !hex.isEmpty, hex.count <= 32, hex.allSatisfy({ $0.isHexDigit }) else { throw HarborError.message("AES IV 无效") }
            let padded = String(repeating:"0", count:32 - hex.count) + hex
            var result = Data(); var cursor = padded.startIndex
            for _ in 0..<16 { let end = padded.index(cursor, offsetBy:2); result.append(UInt8(padded[cursor..<end], radix:16)!); cursor = end }
            return result
        }
        var result = Data(repeating:0, count:8)
        withUnsafeBytes(of: sequence.bigEndian) { result.append(contentsOf:$0) }
        return result
    }
    static func parse(_ text: String, base: URL) throws -> Playlist {
        let lines = text.replacingOccurrences(of:"\r",with:"").split(separator:"\n").map { $0.trimmingCharacters(in:.whitespacesAndNewlines) }
        guard lines.first == "#EXTM3U" else { throw HarborError.message("不是有效的 M3U8 播放列表") }
        var result = Playlist(), pendingVariant: [String:String]?, sequence: UInt64 = 0
        var keyURL: URL?, explicitIV: String?, rangeText: String?, duration: Double = 0, generation = 0
        var previousRange: (URL, ByteRange)?, currentMap: Part?, emittedMap: Part?
        var ended = false
        func parseRange(_ value: String, url: URL) throws -> ByteRange {
            let bits = value.split(separator:"@", omittingEmptySubsequences:false)
            guard bits.count <= 2, let length = Int64(bits[0]), length > 0 else { throw HarborError.message("无效的 HLS 字节范围") }
            let offset: Int64
            if bits.count == 2, let n = Int64(bits[1]) { offset = n }
            else if bits.count == 1, let previousRange, previousRange.0 == url { offset = previousRange.1.offset + previousRange.1.length }
            else { throw HarborError.message("HLS 隐式字节范围缺少同资源前置范围") }
            guard offset >= 0, offset <= Int64.max - length else { throw HarborError.message("HLS 字节范围溢出") }
            let range = ByteRange(offset:offset,length:length); previousRange = (url,range); return range
        }
        for line in lines.dropFirst() where !line.isEmpty {
            if line.hasPrefix("#EXT-X-STREAM-INF:") { pendingVariant = try attributes(String(line.dropFirst(18))); continue }
            if line.hasPrefix("#EXT-X-MEDIA:") {
                let a = try attributes(String(line.dropFirst(13)))
                if a["TYPE"] == "AUDIO", let group = a["GROUP-ID"], let uri = a["URI"] {
                    result.audio.append(AudioRendition(group:group,name:a["NAME"] ?? "音轨",url:try webURL(uri,relativeTo:base),isDefault:a["DEFAULT"] == "YES"))
                }; continue
            }
            if line.hasPrefix("#EXT-X-KEY:") {
                generation += 1
                let a = try attributes(String(line.dropFirst(11)))
                guard a["METHOD"] == "NONE" || (a["METHOD"] == "AES-128" && (a["KEYFORMAT"] == nil || a["KEYFORMAT"] == "identity")) else { throw HarborError.message("不支持 DRM 或 SAMPLE-AES") }
                if a["METHOD"] == "NONE" { keyURL = nil; explicitIV = nil }
                else { guard let uri = a["URI"] else { throw HarborError.message("AES 密钥地址缺失") }; keyURL = try webURL(uri,relativeTo:base); explicitIV = a["IV"] }
                continue
            }
            if line.hasPrefix("#EXT-X-SESSION-KEY:") || line.hasPrefix("#EXT-X-GAP") || line.hasPrefix("#EXT-X-DISCONTINUITY") {
                throw HarborError.message("原型暂不支持会话密钥、缺失分片或不连续时间轴")
            }
            if line.hasPrefix("#EXT-X-MAP:") {
                let a = try attributes(String(line.dropFirst(11)))
                guard let uri = a["URI"] else { throw HarborError.message("初始化片段地址缺失") }
                let u = try webURL(uri,relativeTo:base)
                if keyURL != nil && explicitIV == nil { throw HarborError.message("加密初始化片段必须有显式 IV") }
                currentMap = Part(url:u, range:try a["BYTERANGE"].map { try parseRange($0,url:u) }, encryption:try keyURL.map { Encryption(url:$0,iv:try iv(explicitIV,sequence:sequence),generation:generation) }, isMap:true)
                continue
            }
            if line.hasPrefix("#EXT-X-MEDIA-SEQUENCE:") { guard let n = UInt64(line.dropFirst(22)) else { throw HarborError.message("无效的分片序号") }; sequence = n; continue }
            if line.hasPrefix("#EXT-X-TARGETDURATION:") {
                guard let value = Double(line.dropFirst(22)), value.isFinite, value > 0, value <= 86400 else { throw HarborError.message("HLS 目标时长无效") }
                result.targetDuration = value; continue
            }
            if line.hasPrefix("#EXT-X-BYTERANGE:") { rangeText = String(line.dropFirst(17)); continue }
            if line.hasPrefix("#EXTINF:") {
                guard let value = Double(line.dropFirst(8).split(separator:",").first ?? ""), value.isFinite, value > 0, value <= 86400 else { throw HarborError.message("HLS 分片时长无效") }
                duration = value; continue
            }
            if line == "#EXT-X-ENDLIST" { ended = true; continue }
            if line.hasPrefix("#") { continue }
            let u = try webURL(line,relativeTo:base)
            if let a = pendingVariant { result.variants.append(Variant(url:u,quality:a["RESOLUTION"] ?? a["BANDWIDTH"] ?? "源画质",codecs:a["CODECS"] ?? "",audioGroup:a["AUDIO"])); pendingVariant = nil; continue }
            if let map = currentMap, map != emittedMap { result.parts.append(map); emittedMap = map }
            let range = try rangeText.map { try parseRange($0,url:u) }
            if range == nil { previousRange = nil }
            result.parts.append(Part(url:u,range:range,encryption:try keyURL.map { Encryption(url:$0,iv:try iv(explicitIV,sequence:sequence),generation:generation) },duration:duration))
            guard sequence < UInt64.max, result.parts.count <= 20000 else { throw HarborError.message("播放列表过大") }
            sequence += 1; rangeText = nil; duration = 0
        }
        if result.variants.isEmpty && (!ended || result.parts.isEmpty) { throw HarborError.message("仅支持带 ENDLIST 的完整点播，不支持直播") }
        guard pendingVariant == nil else { throw HarborError.message("清晰度列表地址缺失") }
        return result
    }
}
