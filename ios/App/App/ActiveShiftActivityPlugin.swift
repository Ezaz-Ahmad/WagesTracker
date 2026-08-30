import Capacitor
import Foundation

@objc(ActiveShiftActivity)
public class ActiveShiftActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ActiveShiftActivity"
    public let jsName = "ActiveShiftActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        .init(#selector(startOrUpdate)),
        .init(#selector(dismiss)),
        .init(#selector(end)),
        .init(#selector(retryPendingClockOut))
    ]

    private var endedObserver: NSObjectProtocol?

    public override func load() {
        endedObserver = NotificationCenter.default.addObserver(
            forName: .wagesTrackerShiftEnded,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self,
                  let shiftId = notification.userInfo?["shiftId"] as? String,
                  let duration = notification.userInfo?["finalDurationSeconds"] as? Int else { return }
            self.notifyListeners("shiftEnded", data: [
                "shiftId": shiftId,
                "finalDurationSeconds": duration
            ])
        }
    }

    deinit {
        if let endedObserver { NotificationCenter.default.removeObserver(endedObserver) }
    }

    @objc func startOrUpdate(_ call: CAPPluginCall) {
        guard let shiftId = call.getString("shiftId"), !shiftId.isEmpty,
              let apiBaseUrl = call.getString("apiBaseUrl"), !apiBaseUrl.isEmpty,
              let clockOutToken = call.getString("clockOutToken"), !clockOutToken.isEmpty,
              let startedAtEpochMs = call.getDouble("startedAtEpochMs") else {
            call.reject("Missing active-shift details", "invalid_argument")
            return
        }
        let location = call.getString("location") ?? "Work shift"

        Task {
            guard #available(iOS 16.1, *) else {
                call.resolve([
                    "status": "unavailable",
                    "reason": "Live Activities require iOS 16.1 or later."
                ])
                return
            }
            do {
                let outcome = try await ShiftActivityCoordinator.shared.startOrUpdate(
                    shiftId: shiftId,
                    apiBaseUrl: apiBaseUrl,
                    clockOutToken: clockOutToken,
                    startedAt: Date(timeIntervalSince1970: startedAtEpochMs / 1000),
                    location: location
                )
                switch outcome.status {
                case .active:
                    call.resolve([
                        "status": "active",
                        "pendingClockOut": outcome.pendingClockOut,
                        "completionNotifications": outcome.completionNotificationAuthorization
                    ])
                case .unavailable(let reason):
                    call.resolve(["status": "unavailable", "reason": reason])
                }
            } catch {
                call.reject(error.localizedDescription, "activity_error")
            }
        }
    }

    @objc func dismiss(_ call: CAPPluginCall) {
        Task {
            guard #available(iOS 16.1, *) else {
                call.resolve()
                return
            }
            await ShiftActivityCoordinator.shared.dismissSurface()
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        let shiftId = call.getString("shiftId")
        let duration = call.getInt("finalDurationSeconds")
        Task {
            guard #available(iOS 16.1, *) else {
                call.resolve()
                return
            }
            await ShiftActivityCoordinator.shared.finishFromApp(
                shiftId: shiftId,
                finalDurationSeconds: duration
            )
            call.resolve()
        }
    }

    @objc func retryPendingClockOut(_ call: CAPPluginCall) {
        Task {
            guard #available(iOS 16.1, *) else {
                call.resolve(["queued": false])
                return
            }
            let queued = await ShiftActivityCoordinator.shared.retryPendingClockOut()
            call.resolve(["queued": queued])
        }
    }
}
