import ActivityKit
import Foundation
import Security
import UserNotifications

extension Notification.Name {
    static let wagesTrackerShiftEnded = Notification.Name("WagesTrackerShiftEnded")
    static let wagesTrackerSmartReminderAction = Notification.Name("WagesTrackerSmartReminderAction")
}

struct SmartReminderSchedulePayload: Codable {
    let accountId: String
    let timeZone: String
    let reminders: [SmartScheduledReminder]
}

struct SmartScheduledReminder: Codable {
    let id: String
    let kind: String
    let fireAtEpochMs: Double
    let title: String
    let body: String
    let weekdayName: String
    let usualTimeLabel: String
    let shiftId: String?
}

struct SmartReminderPendingAction: Codable {
    let accountId: String
    let kind: String
    let reminderId: String
    let shiftId: String?
    let weekdayName: String?
    let usualTimeLabel: String?
}

struct SmartReminderScheduleOutcome {
    let authorization: String
    let scheduledCount: Int
}

/**
 * Owns one-shot local notification requests for the conservative patterns
 * learned in the WebView. These are intentionally not repeating calendar
 * triggers: every foreground data refresh replaces the next seven days from
 * authoritative shift history, so a stale routine can quietly disappear.
 */
final class SmartShiftReminderCoordinator {
    static let shared = SmartShiftReminderCoordinator()

    static let requestPrefix = "smart-shift-"
    static let signInCategory = "SMART_SHIFT_SIGN_IN"
    static let signOutCategory = "SMART_SHIFT_SIGN_OUT"
    static let signInAction = "SMART_SHIFT_ACTION_SIGN_IN"
    static let signOutAction = "SMART_SHIFT_ACTION_SIGN_OUT"
    static let remindLaterAction = "SMART_SHIFT_ACTION_REMIND_LATER"
    static let dismissAction = "SMART_SHIFT_ACTION_DISMISS"

    private let pendingActionKey = "com.ezazahmad.wagestracker.smartReminder.pendingAction.v1"
    private let center = UNUserNotificationCenter.current()
    private let generationLock = NSLock()
    private var syncGeneration = 0

    private init() {}

    static func registerCategories() {
        let remindLater = UNNotificationAction(
            identifier: remindLaterAction,
            title: "Remind Me Later",
            options: []
        )
        let dismiss = UNNotificationAction(
            identifier: dismissAction,
            title: "Dismiss",
            options: []
        )
        let signIn = UNNotificationAction(
            identifier: signInAction,
            title: "Sign In",
            options: [.foreground, .authenticationRequired]
        )
        let signOut = UNNotificationAction(
            identifier: signOutAction,
            title: "Sign Out",
            // Foregrounding is deliberate: the app presents a second,
            // explicit confirmation and never ends a shift from this tap.
            options: [.foreground, .authenticationRequired]
        )
        let signInCategory = UNNotificationCategory(
            identifier: signInCategory,
            actions: [signIn, remindLater, dismiss],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )
        let signOutCategory = UNNotificationCategory(
            identifier: signOutCategory,
            actions: [signOut, remindLater, dismiss],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )
        UNUserNotificationCenter.current().setNotificationCategories([signInCategory, signOutCategory])
    }

    func authorizationStatus() async -> String {
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return "authorized"
        case .denied: return "denied"
        case .notDetermined: return "notDetermined"
        @unknown default: return "unavailable"
        }
    }

    func requestAuthorization() async -> String {
        let current = await authorizationStatus()
        guard current == "notDetermined" else { return current }
        do {
            _ = try await center.requestAuthorization(options: [.alert, .sound])
        } catch {
            return "unavailable"
        }
        return await authorizationStatus()
    }

    func schedule(_ payload: SmartReminderSchedulePayload) async -> SmartReminderScheduleOutcome {
        let generation = beginSync()
        let status = await authorizationStatus()
        guard status == "authorized",
              !payload.accountId.isEmpty,
              payload.accountId.count <= 128,
              TimeZone(identifier: payload.timeZone) != nil else {
            cancelAll()
            return .init(authorization: status, scheduledCount: 0)
        }

        await removeExistingRequests()
        guard isCurrent(generation) else {
            return .init(authorization: status, scheduledCount: 0)
        }
        let now = Date()
        var scheduledCount = 0
        for reminder in payload.reminders.prefix(8) {
            guard isCurrent(generation) else { break }
            let fireDate = Date(timeIntervalSince1970: reminder.fireAtEpochMs / 1000)
            let delay = fireDate.timeIntervalSince(now)
            guard delay >= 30, delay <= 8 * 24 * 60 * 60,
                  ["signIn", "signOut"].contains(reminder.kind),
                  reminder.id.count <= 180 else { continue }

            let content = UNMutableNotificationContent()
            content.title = reminder.title
            content.body = reminder.body
            content.sound = .default
            content.categoryIdentifier = reminder.kind == "signOut"
                ? Self.signOutCategory
                : Self.signInCategory
            content.threadIdentifier = "smart-shift-reminders"
            content.userInfo = [
                "accountId": payload.accountId,
                "kind": reminder.kind,
                "reminderId": reminder.id,
                "shiftId": reminder.shiftId ?? "",
                "weekdayName": reminder.weekdayName,
                "usualTimeLabel": reminder.usualTimeLabel,
                "timeZone": payload.timeZone,
                "snoozeCount": 0
            ]

            let request = UNNotificationRequest(
                identifier: "\(Self.requestPrefix)\(payload.accountId)-\(reminder.id)",
                content: content,
                trigger: UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)
            )
            do {
                try await center.add(request)
                if !isCurrent(generation) {
                    center.removePendingNotificationRequests(withIdentifiers: [request.identifier])
                    break
                }
                scheduledCount += 1
            } catch {
                // One malformed/OS-rejected date must not prevent other
                // reliable weekdays from being scheduled.
                continue
            }
        }
        return .init(authorization: status, scheduledCount: scheduledCount)
    }

    func cancelAll(completion: (() -> Void)? = nil) {
        _ = beginSync()
        center.getPendingNotificationRequests { requests in
            let identifiers = requests
                .map(\.identifier)
                .filter { $0.hasPrefix(Self.requestPrefix) }
            self.center.removePendingNotificationRequests(withIdentifiers: identifiers)
            self.center.getDeliveredNotifications { notifications in
                let deliveredIdentifiers = notifications
                    .map { $0.request.identifier }
                    .filter { $0.hasPrefix(Self.requestPrefix) }
                self.center.removeDeliveredNotifications(withIdentifiers: deliveredIdentifiers)
                completion?()
            }
        }
    }

    func cancelForShift(_ shiftId: String) {
        _ = beginSync()
        center.getPendingNotificationRequests { requests in
            let identifiers = requests.filter { request in
                request.identifier.hasPrefix(Self.requestPrefix)
                && (request.content.userInfo["shiftId"] as? String) == shiftId
            }.map(\.identifier)
            self.center.removePendingNotificationRequests(withIdentifiers: identifiers)
            self.center.removeDeliveredNotifications(withIdentifiers: identifiers)
        }
    }

    private func removeExistingRequests() async {
        let requests = await center.pendingNotificationRequests()
        let identifiers = requests.map(\.identifier).filter { $0.hasPrefix(Self.requestPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
        let delivered = await center.deliveredNotifications()
        let deliveredIdentifiers = delivered
            .map { $0.request.identifier }
            .filter { $0.hasPrefix(Self.requestPrefix) }
        center.removeDeliveredNotifications(withIdentifiers: deliveredIdentifiers)
    }

    private func beginSync() -> Int {
        generationLock.lock()
        syncGeneration += 1
        let value = syncGeneration
        generationLock.unlock()
        return value
    }

    private func isCurrent(_ generation: Int) -> Bool {
        generationLock.lock()
        let matches = generation == syncGeneration
        generationLock.unlock()
        return matches
    }

    func handle(response: UNNotificationResponse, completion: @escaping () -> Void) {
        let actionId = response.actionIdentifier
        if actionId == Self.remindLaterAction {
            let content = response.notification.request.content.mutableCopy() as? UNMutableNotificationContent
            if let content {
                let count = (content.userInfo["snoozeCount"] as? Int ?? 0) + 1
                var info = content.userInfo
                info["snoozeCount"] = count
                content.userInfo = info
                let request = UNNotificationRequest(
                    identifier: "\(response.notification.request.identifier)-snooze-\(count)",
                    content: content,
                    trigger: UNTimeIntervalNotificationTrigger(timeInterval: 15 * 60, repeats: false)
                )
                center.add(request) { _ in completion() }
            } else {
                completion()
            }
            return
        }

        if actionId == Self.dismissAction || actionId == UNNotificationDismissActionIdentifier {
            completion()
            return
        }

        let info = response.notification.request.content.userInfo
        guard let kind = info["kind"] as? String,
              ["signIn", "signOut"].contains(kind),
              actionId == UNNotificationDefaultActionIdentifier
                || actionId == Self.signInAction
                || actionId == Self.signOutAction else {
            completion()
            return
        }
        let action = SmartReminderPendingAction(
            accountId: info["accountId"] as? String ?? "",
            kind: kind,
            reminderId: info["reminderId"] as? String ?? response.notification.request.identifier,
            shiftId: (info["shiftId"] as? String).flatMap { $0.isEmpty ? nil : $0 },
            weekdayName: info["weekdayName"] as? String,
            usualTimeLabel: info["usualTimeLabel"] as? String
        )
        if let data = try? JSONEncoder().encode(action) {
            UserDefaults.standard.set(data, forKey: pendingActionKey)
        }
        DispatchQueue.main.async {
            NotificationCenter.default.post(
                name: .wagesTrackerSmartReminderAction,
                object: nil,
                userInfo: ["action": action]
            )
        }
        completion()
    }

    func consumePendingAction() -> SmartReminderPendingAction? {
        guard let data = UserDefaults.standard.data(forKey: pendingActionKey),
              let action = try? JSONDecoder().decode(SmartReminderPendingAction.self, from: data) else {
            return nil
        }
        UserDefaults.standard.removeObject(forKey: pendingActionKey)
        return action
    }
}

enum ShiftClockOutQueueOutcome: Equatable {
    case queued
    case alreadyQueued
    case unavailable
}

struct ShiftActivityStartOutcome {
    enum Status {
        case active
        case unavailable(String)
    }

    let status: Status
    let pendingClockOut: Bool
    let completionNotificationAuthorization: String
}

/**
 * ActivityKit lifecycle plus the durable, shift-scoped clock-out queue.
 * There is no repeating timer here: WidgetKit renders elapsed time from the
 * stored start Date, so iOS advances it while the app is suspended or gone.
 */
@available(iOS 16.1, *)
actor ShiftActivityCoordinator {
    static let shared = ShiftActivityCoordinator()

    private let credentialService = "com.ezazahmad.wagestracker.activeShift"
    private let credentialAccount = "clockOutCredential"
    private let pendingDefaultsKey = "com.ezazahmad.wagestracker.pendingClockOut.v2"

    private struct StoredCredential: Codable {
        let shiftId: String
        let apiBaseUrl: String
        let clockOutToken: String
        let startedAt: Date
        let location: String
        let appearance: String?
    }

    private struct PendingClockOut: Codable {
        let shiftId: String
        let signOut: String
        var queued: Bool
        var lastError: String?
    }

    func startOrUpdate(
        shiftId: String,
        apiBaseUrl: String,
        clockOutToken: String,
        startedAt: Date,
        location: String,
        appearance: String
    ) async throws -> ShiftActivityStartOutcome {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            return ShiftActivityStartOutcome(
                status: .unavailable("Live Activities are disabled in iOS Settings."),
                pendingClockOut: false,
                completionNotificationAuthorization: await completionNotificationAuthorization()
            )
        }

        let credential = StoredCredential(
            shiftId: shiftId,
            apiBaseUrl: apiBaseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
            clockOutToken: clockOutToken,
            startedAt: startedAt,
            location: location,
            appearance: appearance
        )
        try writeCredential(credential)

        let pending = readPendingClockOut()
        let samePending = pending?.shiftId == shiftId ? pending : nil
        if pending != nil && samePending == nil {
            clearPendingClockOut()
        }

        let state: ShiftActivityAttributes.ContentState
        if let samePending {
            state = .init(
                phase: samePending.queued ? .ending : .retry,
                endedAt: nil,
                finalDurationSeconds: nil,
                message: samePending.queued
                    ? "Ending shift…"
                    : (samePending.lastError ?? "End Shift needs another try"),
                appearance: credential.appearance
            )
        } else {
            state = .init(
                phase: .active,
                endedAt: nil,
                finalDurationSeconds: nil,
                message: nil,
                appearance: credential.appearance
            )
        }

        let attributes = ShiftActivityAttributes(
            shiftId: shiftId,
            startedAt: startedAt,
            location: location
        )

        var keeper: Activity<ShiftActivityAttributes>?
        for activity in Activity<ShiftActivityAttributes>.activities {
            if activity.attributes.shiftId == shiftId && keeper == nil {
                keeper = activity
                await update(activity, state: state)
            } else {
                await end(
                    activity,
                    state: .init(
                        phase: .active,
                        endedAt: nil,
                        finalDurationSeconds: nil,
                        message: nil,
                        appearance: credential.appearance
                    ),
                    immediate: true
                )
            }
        }
        if keeper == nil {
            _ = try requestActivity(attributes: attributes, state: state)
        }

        // Permission for the short completion alert is deliberately separate
        // from Live Activity authorization and never gates the shift/activity.
        let notificationAuthorization = await requestCompletionNotificationAuthorizationIfNeeded()
        return ShiftActivityStartOutcome(
            status: .active,
            pendingClockOut: samePending != nil,
            completionNotificationAuthorization: notificationAuthorization
        )
    }

    func requestSignOutConfirmation(shiftId: String) async {
        guard let credential = readCredential(), credential.shiftId == shiftId else {
            await updateActivities(
                for: shiftId,
                state: .init(
                    phase: .retry,
                    endedAt: nil,
                    finalDurationSeconds: nil,
                    message: "Open WagesTracker to refresh End Shift.",
                    appearance: nil
                )
            )
            return
        }

        if let pending = readPendingClockOut(), pending.shiftId == shiftId {
            await updateActivities(
                for: shiftId,
                state: .init(
                    phase: pending.queued ? .ending : .retry,
                    endedAt: nil,
                    finalDurationSeconds: nil,
                    message: pending.queued
                        ? "Ending shift…"
                        : (pending.lastError ?? "End Shift needs another try"),
                    appearance: credential.appearance
                )
            )
            return
        }

        await updateActivities(
            for: shiftId,
            state: .init(
                phase: .confirming,
                endedAt: nil,
                finalDurationSeconds: nil,
                message: "This ends the shift only. Your account stays signed in.",
                appearance: credential.appearance
            )
        )
    }

    func cancelSignOutConfirmation(shiftId: String) async {
        guard readPendingClockOut()?.shiftId != shiftId else { return }
        await updateActivities(
            for: shiftId,
            state: .init(
                phase: .active,
                endedAt: nil,
                finalDurationSeconds: nil,
                message: nil,
                appearance: readCredential()?.appearance
            )
        )
    }

    func queueClockOut(shiftId: String) async -> ShiftClockOutQueueOutcome {
        guard let credential = readCredential(), credential.shiftId == shiftId else {
            await updateActivities(
                for: shiftId,
                state: .init(
                    phase: .retry,
                    endedAt: nil,
                    finalDurationSeconds: nil,
                    message: "Open WagesTracker to refresh End Shift.",
                    appearance: nil
                )
            )
            return .unavailable
        }

        var pending = readPendingClockOut()
        if pending?.shiftId != shiftId {
            pending = PendingClockOut(
                shiftId: shiftId,
                signOut: Self.currentWallClockTime(),
                queued: false,
                lastError: nil
            )
        }

        if pending?.queued == true,
           await ShiftClockOutBackgroundSession.shared.containsTask(for: shiftId) {
            return .alreadyQueued
        }

        guard var request = makeClockOutRequest(credential: credential, signOut: pending!.signOut),
              let body = request.httpBody else {
            await updateActivities(
                for: shiftId,
                state: .init(
                    phase: .retry,
                    endedAt: nil,
                    finalDurationSeconds: nil,
                    message: "Couldn't prepare End Shift. Open WagesTracker and try again.",
                    appearance: credential.appearance
                )
            )
            return .unavailable
        }
        request.httpBody = nil // background upload tasks receive their body from a durable file

        pending!.queued = true
        pending!.lastError = nil
        writePendingClockOut(pending!)
        await updateActivities(
            for: shiftId,
            state: .init(
                phase: .ending,
                endedAt: nil,
                finalDurationSeconds: nil,
                message: "Ending shift…",
                appearance: credential.appearance
            )
        )

        do {
            try ShiftClockOutBackgroundSession.shared.enqueue(
                request: request,
                body: body,
                shiftId: shiftId
            )
            return .queued
        } catch {
            pending!.queued = false
            pending!.lastError = "Couldn't queue End Shift. Tap Retry."
            writePendingClockOut(pending!)
            await updateActivities(
                for: shiftId,
                state: .init(
                    phase: .retry,
                    endedAt: nil,
                    finalDurationSeconds: nil,
                    message: pending!.lastError,
                    appearance: credential.appearance
                )
            )
            return .unavailable
        }
    }

    func retryPendingClockOut() async -> Bool {
        guard let pending = readPendingClockOut() else { return false }
        let outcome = await queueClockOut(shiftId: pending.shiftId)
        return outcome == .queued || outcome == .alreadyQueued
    }

    /**
     * User-facing preference off: remove every Live Activity immediately but
     * do not end the work shift. An already-confirmed offline clock-out keeps
     * its captured time and iOS-owned upload; without one, the narrow Keychain
     * credential is no longer needed and is removed.
     */
    func dismissSurface() async {
        let neutralState = ShiftActivityAttributes.ContentState(
            phase: .active,
            endedAt: nil,
            finalDurationSeconds: nil,
            message: nil,
            appearance: nil
        )
        for activity in Activity<ShiftActivityAttributes>.activities {
            await end(activity, state: neutralState, immediate: true)
        }
        if readPendingClockOut() == nil {
            deleteCredential()
        }
    }

    func finishFromApp(shiftId: String?, finalDurationSeconds: Int?) async {
        if let shiftId {
            await ShiftClockOutBackgroundSession.shared.cancelTasks(for: shiftId)
            SmartShiftReminderCoordinator.shared.cancelForShift(shiftId)
        }
        let endedAt = Date()
        let appearance = readCredential()?.appearance
        let finalState = ShiftActivityAttributes.ContentState(
            phase: .completed,
            endedAt: endedAt,
            finalDurationSeconds: finalDurationSeconds,
            message: "Shift saved",
            appearance: appearance
        )
        for activity in Activity<ShiftActivityAttributes>.activities
        where shiftId == nil || activity.attributes.shiftId == shiftId {
            await end(activity, state: finalState, immediate: true)
        }
        deleteCredential()
        clearPendingClockOut()
        if let finalDurationSeconds {
            await postCompletionNotification(finalDurationSeconds: finalDurationSeconds)
        }
    }

    func backgroundRequestCompleted(
        shiftId: String,
        statusCode: Int?,
        responseData: Data,
        error: Error?
    ) async {
        guard let pending = readPendingClockOut(), pending.shiftId == shiftId else { return }
        if let statusCode, (200...299).contains(statusCode), error == nil {
            let duration = Self.finalDurationSeconds(from: responseData) ?? 0
            await finishFromApp(shiftId: shiftId, finalDurationSeconds: duration)
            NotificationCenter.default.post(
                name: .wagesTrackerShiftEnded,
                object: nil,
                userInfo: ["shiftId": shiftId, "finalDurationSeconds": duration]
            )
            return
        }

        var failed = pending
        failed.queued = false
        failed.lastError = Self.serverError(from: responseData)
            ?? error?.localizedDescription
            ?? "Couldn't end shift. Tap Retry when you're connected."
        writePendingClockOut(failed)
        await updateActivities(
            for: shiftId,
            state: .init(
                phase: .retry,
                endedAt: nil,
                finalDurationSeconds: nil,
                message: failed.lastError,
                appearance: readCredential()?.appearance
            )
        )
    }

    // MARK: ActivityKit compatibility helpers

    @available(iOS 16.1, *)
    private func requestActivity(
        attributes: ShiftActivityAttributes,
        state: ShiftActivityAttributes.ContentState
    ) throws -> Activity<ShiftActivityAttributes> {
        if #available(iOS 16.2, *) {
            return try Activity.request(
                attributes: attributes,
                content: ActivityContent(
                    state: state,
                    staleDate: attributes.startedAt.addingTimeInterval(48 * 60 * 60)
                ),
                pushType: nil
            )
        }
        return try Activity.request(attributes: attributes, contentState: state, pushType: nil)
    }

    @available(iOS 16.1, *)
    private func update(
        _ activity: Activity<ShiftActivityAttributes>,
        state: ShiftActivityAttributes.ContentState
    ) async {
        if #available(iOS 16.2, *) {
            await activity.update(ActivityContent(state: state, staleDate: nil))
        } else {
            await activity.update(using: state)
        }
    }

    @available(iOS 16.1, *)
    private func end(
        _ activity: Activity<ShiftActivityAttributes>,
        state: ShiftActivityAttributes.ContentState,
        immediate: Bool
    ) async {
        if #available(iOS 16.2, *) {
            await activity.end(
                ActivityContent(state: state, staleDate: nil),
                dismissalPolicy: immediate ? .immediate : .default
            )
        } else {
            await activity.end(using: state, dismissalPolicy: immediate ? .immediate : .default)
        }
    }

    @available(iOS 16.1, *)
    private func updateActivities(
        for shiftId: String,
        state: ShiftActivityAttributes.ContentState
    ) async {
        for activity in Activity<ShiftActivityAttributes>.activities
        where activity.attributes.shiftId == shiftId {
            await update(activity, state: state)
        }
    }

    // MARK: Request and persistence

    private func makeClockOutRequest(credential: StoredCredential, signOut: String) -> URLRequest? {
        guard let encodedId = credential.shiftId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let url = URL(string: "\(credential.apiBaseUrl)/api/shifts/\(encodedId)/clock-out-action"),
              let body = try? JSONSerialization.data(withJSONObject: ["signOut": signOut]) else {
            return nil
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(credential.clockOutToken, forHTTPHeaderField: "X-Shift-Clock-Out-Token")
        request.setValue(TimeZone.current.identifier, forHTTPHeaderField: "X-Client-Time-Zone")
        request.httpBody = body
        return request
    }

    private func writeCredential(_ credential: StoredCredential) throws {
        let data = try JSONEncoder().encode(credential)
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: credentialService,
            kSecAttrAccount as String: credentialAccount
        ]
        SecItemDelete(base as CFDictionary)
        var query = base
        query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        query[kSecValueData as String] = data
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(
                domain: "ActiveShiftActivity",
                code: Int(status),
                userInfo: [NSLocalizedDescriptionKey: "Couldn't securely store the shift clock-out credential."]
            )
        }
    }

    private func readCredential() -> StoredCredential? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: credentialService,
            kSecAttrAccount as String: credentialAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(StoredCredential.self, from: data)
    }

    private func deleteCredential() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: credentialService,
            kSecAttrAccount as String: credentialAccount
        ]
        SecItemDelete(query as CFDictionary)
    }

    private func readPendingClockOut() -> PendingClockOut? {
        guard let data = UserDefaults.standard.data(forKey: pendingDefaultsKey) else { return nil }
        return try? JSONDecoder().decode(PendingClockOut.self, from: data)
    }

    private func writePendingClockOut(_ pending: PendingClockOut) {
        guard let data = try? JSONEncoder().encode(pending) else { return }
        UserDefaults.standard.set(data, forKey: pendingDefaultsKey)
    }

    private func clearPendingClockOut() {
        UserDefaults.standard.removeObject(forKey: pendingDefaultsKey)
    }

    private static func currentWallClockTime() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: Date())
    }

    private static func finalDurationSeconds(from data: Data) -> Int? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return json["finalDurationSeconds"] as? Int
    }

    private static func serverError(from data: Data) -> String? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return json["error"] as? String
    }

    private func completionNotificationAuthorization() async -> String {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return "authorized"
        case .denied: return "denied"
        case .notDetermined: return "notDetermined"
        @unknown default: return "denied"
        }
    }

    private func requestCompletionNotificationAuthorizationIfNeeded() async -> String {
        let current = await completionNotificationAuthorization()
        guard current == "notDetermined" else { return current }
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        return await completionNotificationAuthorization()
    }

    private func postCompletionNotification(finalDurationSeconds: Int) async {
        guard await completionNotificationAuthorization() == "authorized" else { return }
        let content = UNMutableNotificationContent()
        content.title = "Shift ended"
        content.body = "\(Self.formatDuration(finalDurationSeconds)) worked. Your saved totals are up to date."
        content.sound = .default
        let request = UNNotificationRequest(
            identifier: "shift-ended-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )
        try? await UNUserNotificationCenter.current().add(request)
    }

    private static func formatDuration(_ seconds: Int) -> String {
        let safe = max(0, seconds)
        let hours = safe / 3600
        let minutes = (safe % 3600) / 60
        return hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes)m"
    }
}

/** A background upload is owned by iOS, not the WebView process. */
final class ShiftClockOutBackgroundSession: NSObject, URLSessionDataDelegate {
    static let shared = ShiftClockOutBackgroundSession()
    static let identifier = "com.ezazahmad.wagestracker.shift-clock-out"

    private let lock = NSLock()
    private var responseData: [Int: Data] = [:]
    private var eventsCompletionHandler: (() -> Void)?

    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.background(withIdentifier: Self.identifier)
        configuration.waitsForConnectivity = true
        configuration.isDiscretionary = false
        configuration.sessionSendsLaunchEvents = true
        configuration.timeoutIntervalForResource = 48 * 60 * 60
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    func configure() {
        _ = session
    }

    func setEventsCompletionHandler(_ handler: @escaping () -> Void) {
        lock.lock()
        eventsCompletionHandler = handler
        lock.unlock()
        _ = session
    }

    func containsTask(for shiftId: String) async -> Bool {
        await withCheckedContinuation { continuation in
            session.getAllTasks { tasks in
                continuation.resume(returning: tasks.contains { $0.taskDescription?.hasPrefix("\(shiftId)|") == true })
            }
        }
    }

    func enqueue(request: URLRequest, body: Data, shiftId: String) throws {
        let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ShiftClockOutQueue", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let bodyURL = directory.appendingPathComponent("\(UUID().uuidString).json")
        try body.write(to: bodyURL, options: .atomic)
        let task = session.uploadTask(with: request, fromFile: bodyURL)
        task.taskDescription = "\(shiftId)|\(bodyURL.path)"
        task.resume()
    }

    func cancelTasks(for shiftId: String) async {
        await withCheckedContinuation { continuation in
            session.getAllTasks { tasks in
                tasks.filter { $0.taskDescription?.hasPrefix("\(shiftId)|") == true }.forEach { $0.cancel() }
                continuation.resume()
            }
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        responseData[dataTask.taskIdentifier, default: Data()].append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let data = responseData.removeValue(forKey: task.taskIdentifier) ?? Data()
        lock.unlock()

        let parts = task.taskDescription?.split(separator: "|", maxSplits: 1).map(String.init) ?? []
        guard let shiftId = parts.first else { return }
        if parts.count == 2 { try? FileManager.default.removeItem(atPath: parts[1]) }
        let statusCode = (task.response as? HTTPURLResponse)?.statusCode
        Task {
            guard #available(iOS 16.1, *) else { return }
            await ShiftActivityCoordinator.shared.backgroundRequestCompleted(
                shiftId: shiftId,
                statusCode: statusCode,
                responseData: data,
                error: error
            )
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        lock.lock()
        let completion = eventsCompletionHandler
        eventsCompletionHandler = nil
        lock.unlock()
        DispatchQueue.main.async { completion?() }
    }
}

final class ActiveShiftNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = ActiveShiftNotificationDelegate()

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        guard response.notification.request.identifier.hasPrefix(SmartShiftReminderCoordinator.requestPrefix) else {
            completionHandler()
            return
        }
        SmartShiftReminderCoordinator.shared.handle(response: response, completion: completionHandler)
    }
}
