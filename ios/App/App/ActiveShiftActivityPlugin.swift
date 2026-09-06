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
        .init(#selector(retryPendingClockOut)),
        .init(#selector(smartReminderAuthorizationStatus)),
        .init(#selector(requestSmartReminderAuthorization)),
        .init(#selector(scheduleSmartReminders)),
        .init(#selector(cancelSmartReminders)),
        .init(#selector(consumePendingSmartReminderAction))
    ]

    private var endedObserver: NSObjectProtocol?
    private var smartReminderObserver: NSObjectProtocol?

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
        smartReminderObserver = NotificationCenter.default.addObserver(
            forName: .wagesTrackerSmartReminderAction,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self,
                  let action = notification.userInfo?["action"] as? SmartReminderPendingAction else { return }
            self.notifyListeners("smartReminderAction", data: self.smartActionData(action))
        }
    }

    deinit {
        if let endedObserver { NotificationCenter.default.removeObserver(endedObserver) }
        if let smartReminderObserver { NotificationCenter.default.removeObserver(smartReminderObserver) }
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
        let requestedAppearance = call.getString("appearance") ?? "system"
        let appearance = ["light", "dark", "system"].contains(requestedAppearance)
            ? requestedAppearance
            : "system"

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
                    location: location,
                    appearance: appearance
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

    @objc func smartReminderAuthorizationStatus(_ call: CAPPluginCall) {
        Task {
            let status = await SmartShiftReminderCoordinator.shared.authorizationStatus()
            call.resolve(["authorization": status])
        }
    }

    @objc func requestSmartReminderAuthorization(_ call: CAPPluginCall) {
        Task {
            let status = await SmartShiftReminderCoordinator.shared.requestAuthorization()
            call.resolve(["authorization": status])
        }
    }

    @objc func scheduleSmartReminders(_ call: CAPPluginCall) {
        guard let raw = call.getString("payload"),
              let data = raw.data(using: .utf8) else {
            call.reject("Missing smart-reminder schedule", "invalid_argument")
            return
        }
        do {
            let payload = try JSONDecoder().decode(SmartReminderSchedulePayload.self, from: data)
            Task {
                let outcome = await SmartShiftReminderCoordinator.shared.schedule(payload)
                call.resolve([
                    "authorization": outcome.authorization,
                    "scheduledCount": outcome.scheduledCount
                ])
            }
        } catch {
            call.reject("Invalid smart-reminder schedule", "invalid_argument")
        }
    }

    @objc func cancelSmartReminders(_ call: CAPPluginCall) {
        SmartShiftReminderCoordinator.shared.cancelAll {
            call.resolve()
        }
    }

    @objc func consumePendingSmartReminderAction(_ call: CAPPluginCall) {
        if let action = SmartShiftReminderCoordinator.shared.consumePendingAction() {
            call.resolve(["action": smartActionData(action)])
        } else {
            call.resolve()
        }
    }

    private func smartActionData(_ action: SmartReminderPendingAction) -> JSObject {
        var data: JSObject = [
            "accountId": action.accountId,
            "kind": action.kind,
            "reminderId": action.reminderId
        ]
        if let shiftId = action.shiftId { data["shiftId"] = shiftId }
        if let weekdayName = action.weekdayName { data["weekdayName"] = weekdayName }
        if let usualTimeLabel = action.usualTimeLabel { data["usualTimeLabel"] = usualTimeLabel }
        return data
    }
}
