import UIKit
import Capacitor

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey:Any]?) -> Bool {
        window = UIWindow(frame:UIScreen.main.bounds)
        window?.rootViewController = HarborViewController()
        window?.makeKeyAndVisible()
        _ = DownloadEngine.shared
        return true
    }
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        guard identifier == DownloadEngine.sessionID, let engine = try? DownloadEngine.shared.get() else { completionHandler(); return }
        engine.backgroundCompletion = completionHandler
    }
}
class HarborViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(HarborPlugin()) }
}
