import UIKit
import Capacitor

/// Owns the single app window and custom plugin-registering bridge.
/// Notification and background-session delegates remain in AppDelegate.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene, session.role == .windowApplication else { return }
        let appWindow = UIWindow(windowScene: windowScene)
        appWindow.rootViewController = MainViewController()
        window = appWindow
        appWindow.makeKeyAndVisible()
        // Capacitor queues cold-launch links until the bridge plugins exist.
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
