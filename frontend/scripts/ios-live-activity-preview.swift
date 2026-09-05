// Compiled only by render-ios-live-activity.mjs, never shipped in the app.
import SwiftUI
import UIKit

@main
final class LiveActivityPreviewApp: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    private var didStartRendering = false

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = UIViewController()
        window?.makeKeyAndVisible()
        return true
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        guard !didStartRendering else { return }
        didStartRendering = true
        Task { @MainActor in await renderCases() }
    }

    @MainActor
    private func renderCases() async {
        let output = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        var results: [[String: Any]] = []
        let phases: [ShiftActivityAttributes.ContentState.Phase] = [.active, .confirming, .ending, .retry, .completed]
        for width in [320.0, 356.0, 408.0] {
            for scheme in [ColorScheme.dark, .light] {
                for phase in phases {
                    await render(width: width, scheme: scheme, phase: phase, size: .large, output: output, results: &results)
                }
            }
        }
        for phase in phases {
            for size in [DynamicTypeSize.xxxLarge, .accessibility3] {
                await render(width: 320, scheme: .dark, phase: phase, size: size, output: output, results: &results)
            }
        }
        do {
            let data = try JSONSerialization.data(withJSONObject: results, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: output.appendingPathComponent("layout-results.json"))
        } catch {
            print("Could not write preview results: \(error)")
            exit(1)
        }
        exit(results.allSatisfy { ($0["height"] as? Double ?? 1000) <= 160 } ? 0 : 1)
    }

    @MainActor
    private func render(width: Double, scheme: ColorScheme, phase: ShiftActivityAttributes.ContentState.Phase,
                        size: DynamicTypeSize, output: URL, results: inout [[String: Any]]) async {
        let name = "\(Int(width))-\(scheme)-\(phase.rawValue)-\(size)"
        let start = Date().addingTimeInterval(-(9 * 3600 + 22 * 60 + 41))
        let state = ShiftActivityAttributes.ContentState(
            phase: phase, endedAt: phase == .completed ? .now : nil,
            finalDurationSeconds: phase == .completed ? 8 * 3600 : nil,
            message: phase == .retry ? "Couldn't reach the server. Tap Retry to save your shift." : "Waiting for a connection. Your end time is saved.",
            appearance: scheme == .dark ? "dark" : "light"
        )
        let view = ShiftLockScreenView(
            attributes: .init(shiftId: "preview", startedAt: start, location: "Gosford by train · Long work location name"),
            state: state
        )
        .background(Color(uiColor: .secondarySystemBackground))
        .environment(\.colorScheme, scheme)
        .environment(\.dynamicTypeSize, size)
        let controller = UIHostingController(rootView: view)
        // A Live Activity has no app status bar or home-indicator safe area.
        // Exclude those UIKit insets when measuring the actual widget content.
        controller.safeAreaRegions = []
        window?.rootViewController = controller
        let fit = controller.sizeThatFits(in: CGSize(width: width, height: 1000))
        let height = ceil(fit.height)
        window?.frame = CGRect(x: 0, y: 0, width: width, height: height)
        controller.view.frame = CGRect(x: 0, y: 0, width: width, height: height)
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()
        try? await Task.sleep(for: .milliseconds(150))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 3
        let image = UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).image { _ in
            controller.view.drawHierarchy(in: CGRect(x: 0, y: 0, width: width, height: height), afterScreenUpdates: true)
        }
        do {
            guard let data = image.pngData() else { throw CocoaError(.fileWriteUnknown) }
            try data.write(to: output.appendingPathComponent("\(name).png"))
        } catch {
            print("Could not save \(name): \(error)")
            exit(1)
        }
        results.append(["name": name, "width": width, "height": height, "fitsLiveActivity": height <= 160])
        print("\(name): \(width) × \(height)")
    }
}
