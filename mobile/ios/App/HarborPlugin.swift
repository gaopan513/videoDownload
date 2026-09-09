import Capacitor
import UIKit
import Photos

@objc(HarborPlugin)
public class HarborPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HarborPlugin"
    public let jsName = "Harbor"
    public let pluginMethods: [CAPPluginMethod] = ["snapshot","resolve","inspect","add","control","exportFile"].map { CAPPluginMethod(name:$0,returnType:CAPPluginReturnPromise) }
    private var resolver: Resolver?
    private var candidates: [String:MediaCandidate] = [:]
    private var prepared: [String:([DownloadPart],Date)] = [:]
    private var working = false
    private func run(_ call: CAPPluginCall, _ operation: @escaping @MainActor (DownloadEngine) async throws -> JSObject) {
        Task { @MainActor in
            do {
                let engine = try DownloadEngine.shared.get()
                await engine.startup?.value
                guard engine.storageError == nil else { throw HarborError.message(engine.storageError!) }
                engine.changed = { [weak self] tasks in self?.notifyListeners("tasks",data:["tasks":tasks]) }
                call.resolve(try await operation(engine))
            } catch {
                let message = (error as? HarborError)?.errorDescription ?? "操作失败，请检查网络、手机空间或重新打开网页"
                call.reject(message)
            }
        }
    }
    @objc func snapshot(_ call: CAPPluginCall) {
        run(call) { engine in ["tasks":engine.jobs.map(\.publicValue),"prototype":true] }
    }
    @objc func resolve(_ call: CAPPluginCall) {
        run(call) { _ in
            guard !self.working else { throw HarborError.message("请等待当前识别完成") }
            self.working = true; defer { self.working = false }
            guard let raw = call.getString("url"), let presenter = self.bridge?.viewController else { throw HarborError.message("链接或页面不可用") }
            self.candidates = [:]; self.prepared = [:]
            if self.resolver == nil { self.resolver = Resolver() }
            let result = try await self.resolver!.resolve(webURL(raw),interactive:call.getBool("interactive") ?? false,presenter:presenter)
            for candidate in result { self.candidates[candidate.id] = candidate }
            return ["candidates":result.map(\.publicValue)]
        }
    }
    @objc func inspect(_ call: CAPPluginCall) {
        run(call) { _ in
            guard !self.working else { throw HarborError.message("请等待当前检查完成") }
            self.working = true; defer { self.working = false }
            guard let id = call.getString("id"), var candidate = self.candidates[id] else { throw HarborError.message("资源已失效，请重新识别") }
            let http = HTTP(candidate.context); defer { http.close() }
            let parts = try await http.prepare(candidate)
            candidate.codec = await http.preflight(candidate,parts:parts)
            candidate.message = candidate.codec == "supported" ? "样本编码检查通过；下载完成后仍会检查完整文件" : candidate.codec == "unsupported" ? "编码不兼容，原型仅支持 H.264/AAC" : "无法预先确认编码，可以选择尝试下载"
            self.candidates[id] = candidate
            self.prepared[id] = (parts,Date())
            return ["codec":candidate.codec,"message":candidate.message]
        }
    }
    @objc func add(_ call: CAPPluginCall) {
        run(call) { engine in
            guard let id = call.getString("id"), let candidate = self.candidates[id], let (parts,date) = self.prepared[id], Date().timeIntervalSince(date) < 300 else { throw HarborError.message("请重新进行编码检查后下载") }
            guard candidate.codec != "unsupported", candidate.codec == "supported" || call.getBool("allowUnknown") == true else { throw HarborError.message("编码未确认，需要先选择是否继续") }
            try engine.add(candidate,parts:parts); self.prepared.removeValue(forKey:id)
            return [:]
        }
    }
    @objc func control(_ call: CAPPluginCall) {
        run(call) { engine in
            guard let id = call.getString("id"), let action = call.getString("action") else { throw HarborError.message("操作参数缺失") }
            try await engine.control(id,action:action); return [:]
        }
    }
    @objc func exportFile(_ call: CAPPluginCall) {
        run(call) { engine in
            guard let id = call.getString("id"), let destination = call.getString("destination") else { throw HarborError.message("导出参数缺失") }
            let url = try engine.output(id)
            if destination == "photos" {
                let permission = await PHPhotoLibrary.requestAuthorization(for:.addOnly)
                guard permission == .authorized || permission == .limited else { throw HarborError.message("未获得相册写入权限，仍可通过分享保存到文件") }
                guard UIVideoAtPathIsCompatibleWithSavedPhotosAlbum(url.path) else { throw HarborError.message("此 MP4 无法保存到相册，请保存到文件") }
                try await PHPhotoLibrary.shared().performChanges { PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL:url) }
            } else if destination == "share" {
                guard let presenter = self.bridge?.viewController, presenter.presentedViewController == nil else { throw HarborError.message("请先关闭当前窗口") }
                let sheet = UIActivityViewController(activityItems:[url],applicationActivities:nil)
                sheet.popoverPresentationController?.sourceView = presenter.view
                sheet.popoverPresentationController?.sourceRect = CGRect(x:presenter.view.bounds.midX,y:presenter.view.bounds.midY,width:1,height:1)
                presenter.present(sheet,animated:true)
            } else { throw HarborError.message("不支持的导出方式") }
            return [:]
        }
    }
}
