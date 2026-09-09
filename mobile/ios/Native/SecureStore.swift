import Foundation
import Security
import CryptoKit

final class SecureStore {
    let root: URL
    private let key: SymmetricKey
    init() throws {
        root = try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true).appendingPathComponent("Harbor",isDirectory:true)
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication])
        var directory = root; var values = URLResourceValues(); values.isExcludedFromBackup = true; try directory.setResourceValues(values)
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"StreamHarbor.StateKey",kSecAttrAccount as String:"v1"]
        var lookup = query; lookup[kSecReturnData as String] = true
        var found: CFTypeRef?
        let result = SecItemCopyMatching(lookup as CFDictionary,&found)
        if result == errSecSuccess, let bytes = found as? Data { key = SymmetricKey(data:bytes) }
        else if result == errSecItemNotFound {
            // Never silently replace a missing key when an encrypted state file exists.
            guard !FileManager.default.fileExists(atPath:root.appendingPathComponent("jobs.enc").path) else { throw HarborError.message("恢复密钥缺失，无法读取旧任务") }
            key = SymmetricKey(size:.bits256)
            var insert = query; insert[kSecValueData as String] = key.withUnsafeBytes { Data($0) }; insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(insert as CFDictionary,nil) == errSecSuccess else { throw HarborError.message("无法保存任务加密密钥") }
        } else { throw HarborError.message("无法访问任务密钥，请解锁手机后重试") }
    }
    func load() throws -> [DownloadJob] {
        let file = root.appendingPathComponent("jobs.enc")
        guard FileManager.default.fileExists(atPath:file.path) else { return [] }
        return try JSONDecoder().decode([DownloadJob].self,from:AES.GCM.open(AES.GCM.SealedBox(combined:Data(contentsOf:file)),using:key))
    }
    func save(_ jobs: [DownloadJob]) throws {
        let data = try AES.GCM.seal(JSONEncoder().encode(jobs),using:key).combined!
        try data.write(to:root.appendingPathComponent("jobs.enc"),options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication])
    }
    func directory(_ id: String) throws -> URL {
        guard UUID(uuidString:id) != nil else { throw HarborError.message("任务标识无效") }
        let path = root.appendingPathComponent(id,isDirectory:true)
        try FileManager.default.createDirectory(at:path,withIntermediateDirectories:true,attributes:[.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication])
        return path
    }
}
