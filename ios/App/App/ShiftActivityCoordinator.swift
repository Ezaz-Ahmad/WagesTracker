import ActivityKit
import Foundation
import Security
import UserNotifications

extension Notification.Name {
    static let wagesTrackerShiftEnded = Notification.Name("WagesTrackerShiftEnded")
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
        location: String
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
            location: location
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
                    ? "Clock-out queued"
                    : (samePending.lastError ?? "Clock-out needs another try")
            )
        } else {
            state = .init(phase: .active, endedAt: nil, finalDurationSeconds: nil, message: nil)
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
                    state: .init(phase: .active, endedAt: nil, finalDurationSeconds: nil, message: nil),
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

    func queueClockOut(shiftId: String) async -> ShiftClockOutQueueOutcome {
        guard let credential = readCredential(), credential.shiftId == shiftId else {
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
            return .unavailable
        }
        request.httpBody = nil // background upload tasks receive their body from a durable file

        pending!.queued = true
        pending!.lastError = nil
        writePendingClockOut(pending!)
        await updateActivities(
            for: shiftId,
            state: .init(phase: .ending, endedAt: nil, finalDurationSeconds: nil, message: "Clock-out queued")
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
            pending!.lastError = "Couldn't queue clock-out. Tap Retry."
            writePendingClockOut(pending!)
            await updateActivities(
                for: shiftId,
                state: .init(phase: .retry, endedAt: nil, finalDurationSeconds: nil, message: pending!.lastError)
            )
            return .unavailable
        }
    }

    func retryPendingClockOut() async -> Bool {
        guard let pending = readPendingClockOut() else { return false }
        let outcome = await queueClockOut(shiftId: pending.shiftId)
        return outcome == .queued || outcome == .alreadyQueued
    }

    func finishFromApp(shiftId: String?, finalDurationSeconds: Int?) async {
        if let shiftId {
            await ShiftClockOutBackgroundSession.shared.cancelTasks(for: shiftId)
        }
        let endedAt = Date()
        let finalState = ShiftActivityAttributes.ContentState(
            phase: .completed,
            endedAt: endedAt,
            finalDurationSeconds: finalDurationSeconds,
            message: "Shift saved"
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
            state: .init(phase: .retry, endedAt: nil, finalDurationSeconds: nil, message: failed.lastError)
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
                    staleDate: attributes.startedAt.addingTimeInterval(8 * 60 * 60)
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
}
