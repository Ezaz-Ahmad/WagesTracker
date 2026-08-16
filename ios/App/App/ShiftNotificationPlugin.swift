import Capacitor
import Foundation
import Security
import UserNotifications

/// Bridges a persistent "shift in progress" local notification, with its
/// own "Sign out" action button, into the same shift-tracking flow the
/// Home screen's own card already drives. Posted the moment a shift starts
/// (see `useTodayShift.ts`), it sits in the notification center — surviving
/// backgrounding, locking, and closing the app — until the user swipes it
/// away or the shift actually ends, one way or another.
///
/// iOS has no concept of a truly undismissable notification (that is an
/// Android-only, foreground-service idea) — the user can always swipe this
/// away. Doing so only clears the notification; it does not end the shift,
/// which keeps running underneath exactly as if the notification had never
/// existed.
///
/// Tapping "Sign out" needs to work even when the app process isn't
/// currently running. iOS will briefly relaunch/resume an app specifically
/// to deliver a notification response (see `UNUserNotificationCenterDelegate`
/// below), but that window is short, and a Capacitor WebView is not
/// something worth depending on finishing a cold start inside it. So this
/// plugin performs the exact same request the in-app Sign out button makes
/// (`PATCH /api/shifts/:id`, see `frontend/src/lib/api.ts`'s `patchShift`)
/// directly via `URLSession`, entirely in native code, using credentials
/// handed to it — and stored in their own Keychain item, mirroring
/// `BiometricAuthPlugin`'s pattern — when the shift started. If that
/// request can't complete in time, the attempt is recorded as "pending"
/// (see `getPendingEndShift`) rather than lost, so `AppContext` can finish
/// it the next time the app is opened, through the ordinary, already-tested
/// JS API client instead.
@objc(ShiftNotification)
public class ShiftNotificationPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "ShiftNotification"
  public let jsName = "ShiftNotification"
  public let pluginMethods: [CAPPluginMethod] = [
    .init(#selector(postShiftStarted)),
    .init(#selector(clearShiftNotification)),
    .init(#selector(getPendingEndShift)),
    .init(#selector(clearPendingEndShift))
  ]

  @objc func postShiftStarted(_ call: CAPPluginCall) {
    guard let shiftId = call.getString("shiftId"), !shiftId.isEmpty else {
      call.reject("Missing shiftId", "invalid_argument")
      return
    }
    guard let apiBaseUrl = call.getString("apiBaseUrl"), !apiBaseUrl.isEmpty else {
      call.reject("Missing apiBaseUrl", "invalid_argument")
      return
    }
    guard let token = call.getString("token"), !token.isEmpty else {
      call.reject("Missing token", "invalid_argument")
      return
    }
    let startedAtLabel = call.getString("startedAtLabel") ?? "Shift in progress"

    ShiftNotificationCenter.shared.postShiftStarted(
      shiftId: shiftId,
      apiBaseUrl: apiBaseUrl,
      token: token,
      startedAtLabel: startedAtLabel
    ) { error in
      if let error {
        call.reject(error.localizedDescription, "notification_error")
      } else {
        call.resolve()
      }
    }
  }

  @objc func clearShiftNotification(_ call: CAPPluginCall) {
    ShiftNotificationCenter.shared.clearShiftNotification()
    call.resolve()
  }

  @objc func getPendingEndShift(_ call: CAPPluginCall) {
    // `call.resolve()` can only ever resolve to a JS object, never a bare
    // `null` — `hasPending` is the explicit, unambiguous signal the JS side
    // checks, rather than inferring "nothing pending" from missing keys on
    // an otherwise-empty object.
    if let pending = ShiftNotificationCenter.shared.readPendingEndShift() {
      call.resolve(["hasPending": true, "shiftId": pending.shiftId, "signOut": pending.signOut])
    } else {
      call.resolve(["hasPending": false])
    }
  }

  @objc func clearPendingEndShift(_ call: CAPPluginCall) {
    ShiftNotificationCenter.shared.clearPendingEndShift()
    call.resolve()
  }
}

/// The actual notification/Keychain/background-request logic, deliberately
/// kept independent of `CAPPlugin`/the Capacitor bridge: `AppDelegate` sets
/// this object as `UNUserNotificationCenter`'s delegate and registers the
/// notification category as early as possible in
/// `application(_:didFinishLaunchingWithOptions:)`, *before* the bridge or
/// any view controller exists — a background-launched notification response
/// must be handled correctly whether or not the rest of the app ever
/// finishes starting up in that particular launch.
final class ShiftNotificationCenter: NSObject, UNUserNotificationCenterDelegate {
  static let shared = ShiftNotificationCenter()

  private override init() { super.init() }

  private let notificationIdentifier = "shift-in-progress"
  private let categoryIdentifier = "SHIFT_IN_PROGRESS"
  private let endShiftActionIdentifier = "END_SHIFT_ACTION"

  private let keychainService = "com.ezazahmad.wagestracker.shiftNotification"
  private let keychainAccount = "credential"
  private let pendingEndShiftDefaultsKey = "com.ezazahmad.wagestracker.pendingEndShift"

  private struct StoredCredential: Codable {
    let shiftId: String
    let apiBaseUrl: String
    let token: String
  }

  struct PendingEndShift {
    let shiftId: String
    let signOut: String
  }

  /// Registers the notification category/action. Idempotent and cheap —
  /// safe to call on every launch. Must run before any notification using
  /// this category is posted, and before this delegate can meaningfully
  /// receive a response for it, so `AppDelegate` calls this immediately.
  func configureCategories() {
    let endShiftAction = UNNotificationAction(
      identifier: endShiftActionIdentifier,
      title: "Sign out",
      // Deliberately omits `.foreground` — this keeps the action handled
      // in the background without necessarily bringing the app's UI
      // forward, matching a quick "one tap and done" expectation rather
      // than interrupting whatever the user was doing on their phone.
      // `.destructive` matches the in-app Sign out button's red styling.
      options: [.destructive]
    )
    let category = UNNotificationCategory(
      identifier: categoryIdentifier,
      actions: [endShiftAction],
      intentIdentifiers: [],
      options: []
    )
    UNUserNotificationCenter.current().setNotificationCategories([category])
  }

  // MARK: - Posting

  func postShiftStarted(
    shiftId: String,
    apiBaseUrl: String,
    token: String,
    startedAtLabel: String,
    completion: @escaping (Error?) -> Void
  ) {
    let center = UNUserNotificationCenter.current()
    center.getNotificationSettings { settings in
      switch settings.authorizationStatus {
      case .authorized, .provisional:
        self.present(shiftId: shiftId, apiBaseUrl: apiBaseUrl, token: token, startedAtLabel: startedAtLabel, completion: completion)
      case .notDetermined:
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
          if granted {
            self.present(shiftId: shiftId, apiBaseUrl: apiBaseUrl, token: token, startedAtLabel: startedAtLabel, completion: completion)
          } else {
            // The shift itself already started successfully by the time
            // this runs (see useTodayShift.ts) — a declined permission is
            // not a failure of anything the caller asked for, just nothing
            // further to show. Resolve cleanly rather than reject.
            completion(nil)
          }
        }
      case .denied, .ephemeral:
        completion(nil)
      @unknown default:
        completion(nil)
      }
    }
  }

  private func present(
    shiftId: String,
    apiBaseUrl: String,
    token: String,
    startedAtLabel: String,
    completion: @escaping (Error?) -> Void
  ) {
    do {
      try writeCredential(StoredCredential(shiftId: shiftId, apiBaseUrl: apiBaseUrl, token: token))
    } catch {
      completion(error)
      return
    }

    let content = UNMutableNotificationContent()
    content.title = "Shift in progress"
    content.body = "\(startedAtLabel) — tap to end shift."
    content.categoryIdentifier = categoryIdentifier
    content.sound = nil

    // `trigger: nil` delivers it immediately, exactly like a normal
    // "shift started" confirmation would appear right away.
    let request = UNNotificationRequest(identifier: notificationIdentifier, content: content, trigger: nil)
    UNUserNotificationCenter.current().add(request) { error in
      completion(error)
    }
  }

  // MARK: - Clearing

  func clearShiftNotification() {
    let center = UNUserNotificationCenter.current()
    center.removeDeliveredNotifications(withIdentifiers: [notificationIdentifier])
    center.removePendingNotificationRequests(withIdentifiers: [notificationIdentifier])
    deleteCredential()
  }

  // MARK: - Pending end-shift record

  func readPendingEndShift() -> PendingEndShift? {
    guard
      let dict = UserDefaults.standard.dictionary(forKey: pendingEndShiftDefaultsKey),
      let shiftId = dict["shiftId"] as? String,
      let signOut = dict["signOut"] as? String
    else {
      return nil
    }
    return PendingEndShift(shiftId: shiftId, signOut: signOut)
  }

  private func writePendingEndShift(_ pending: PendingEndShift) {
    UserDefaults.standard.set(["shiftId": pending.shiftId, "signOut": pending.signOut], forKey: pendingEndShiftDefaultsKey)
  }

  func clearPendingEndShift() {
    UserDefaults.standard.removeObject(forKey: pendingEndShiftDefaultsKey)
  }

  // MARK: - UNUserNotificationCenterDelegate

  /// Lets the notification still be shown/heard even if it were somehow
  /// delivered while the app is in the foreground — not the expected path
  /// for this feature (the shift-in-progress card is already visible
  /// on-screen at that point), but there is no reason to suppress it if it
  /// ever happens.
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
    guard response.notification.request.identifier == notificationIdentifier else {
      completionHandler()
      return
    }
    guard response.actionIdentifier == endShiftActionIdentifier else {
      // The default tap (opening the notification body itself, not the
      // action button) and the dismiss action both need no work here —
      // opening the app normally is already handled by iOS itself, and
      // the shift stays running exactly as it was.
      completionHandler()
      return
    }

    guard let credential = readCredential() else {
      // Nothing stored (already ended in-app, or never posted) — nothing
      // to do. iOS already removes the notification itself once an action
      // on it is handled, so there is no stale UI left behind either.
      completionHandler()
      return
    }

    let signOut = Self.currentWallClockTime()
    performEndShiftRequest(credential: credential, signOut: signOut) { [weak self] succeeded in
      guard let self else {
        completionHandler()
        return
      }
      if succeeded {
        self.deleteCredential()
      } else {
        // Couldn't confirm the request reached the server in time — record
        // it so AppContext finishes the job (or confirms it already
        // succeeded, via its normal data refresh) the next time the app
        // opens, rather than the request simply being lost.
        self.writePendingEndShift(PendingEndShift(shiftId: credential.shiftId, signOut: signOut))
        self.deleteCredential()
      }
      completionHandler()
    }
  }

  // MARK: - Background network request

  private func performEndShiftRequest(credential: StoredCredential, signOut: String, completion: @escaping (Bool) -> Void) {
    guard let url = URL(string: "\(credential.apiBaseUrl)/api/shifts/\(credential.shiftId)") else {
      completion(false)
      return
    }
    var request = URLRequest(url: url)
    request.httpMethod = "PATCH"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
    request.setValue(TimeZone.current.identifier, forHTTPHeaderField: "X-Client-Time-Zone")
    // Well under the OS's own background-execution budget for handling a
    // notification response, so a slow/unreachable server reliably falls
    // through to the "record as pending" path instead of risking the
    // process being suspended mid-request with the completion handler
    // never called at all.
    request.timeoutInterval = 15

    guard let body = try? JSONSerialization.data(withJSONObject: ["signOut": signOut]) else {
      completion(false)
      return
    }
    request.httpBody = body

    let task = URLSession.shared.dataTask(with: request) { _, response, error in
      guard error == nil, let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
        completion(false)
        return
      }
      completion(true)
    }
    task.resume()
  }

  private static func currentWallClockTime() -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "HH:mm:ss"
    formatter.timeZone = TimeZone.current
    formatter.locale = Locale(identifier: "en_US_POSIX")
    return formatter.string(from: Date())
  }

  // MARK: - Keychain

  /// Ordinary (non-biometric-gated) Keychain storage — this credential must
  /// be readable from a background notification-response wake with no user
  /// present to authenticate anything, unlike `BiometricAuthPlugin`'s
  /// `.biometryCurrentSet` credential item. `whenUnlockedThisDeviceOnly`
  /// still keeps it out of backups/other devices and unreadable before the
  /// device's first unlock after a restart, matching every other Keychain
  /// item this app stores.
  private func writeCredential(_ credential: StoredCredential) throws {
    let data = try JSONEncoder().encode(credential)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      kSecValueData as String: data
    ]
    SecItemDelete(query as CFDictionary)
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw NSError(domain: "ShiftNotification", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Could not save the shift notification credential."])
    }
  }

  private func readCredential() -> StoredCredential? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else { return nil }
    return try? JSONDecoder().decode(StoredCredential.self, from: data)
  }

  private func deleteCredential() {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount
    ]
    SecItemDelete(query as CFDictionary)
  }
}
