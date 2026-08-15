import Capacitor
import Foundation
import LocalAuthentication
import Security

/// A small, purpose-built Capacitor plugin bridging Face ID / Touch ID into
/// the shared authentication flow. This exists because the app's only other
/// native storage dependency, `@aparajita/capacitor-secure-storage`
/// (KeychainSwift under the hood — see its `Plugin.swift`), only exposes
/// `kSecAttrAccessible*` options. None of those require the device's current
/// biometric enrollment to read an item back; they gate on "device unlocked",
/// not "the enrolled owner is physically present right now". There is no
/// third-party plugin dependency here at all — this file is compiled
/// directly into the App target (the same "custom native code" mechanism
/// Capacitor documents for app-local plugins), so it carries none of the
/// version-alignment, maintenance or supply-chain risk a new npm dependency
/// would, and it automatically tracks whatever Capacitor/iOS SDK the App
/// target itself builds against.
///
/// Everything below is deliberately a thin bridge: capability detection, one
/// biometric prompt, and opaque Keychain read/write/delete of a caller-
/// supplied string. It has no idea what that string means (a JWT, in
/// practice), does not call the backend, and does not decide what "signed
/// in" means — all of that stays in TypeScript (see
/// `frontend/src/platform/nativeBiometricAuth.ts` and
/// `frontend/src/context/AppContext.tsx`), same as every other adapter under
/// `frontend/src/platform/`.
///
/// Two Keychain items, both scoped to this app's own Keychain access group
/// (no `kSecAttrSynchronizable` — this never leaves the device, matching the
/// rest of the app's Keychain usage):
///
///   - `metaAccount` (kMetaKey) — NOT protected by biometrics. Just enough to
///     answer "is biometric login turned on, and for which account/kind" so
///     the Settings toggle and the login screen's icon can render correctly
///     without ever triggering a Face ID/Touch ID prompt just to draw the UI.
///     Contains no secret — no token, no password.
///   - `credential` (kCredentialKey) — the actual session token, stored under
///     a `SecAccessControl` built with `.biometryCurrentSet`. Per Apple's
///     documentation this ties the item to the *exact* set of enrolled
///     biometrics at the moment it was created: adding, removing or
///     re-enrolling a fingerprint/face invalidates it permanently. That is
///     exactly the "changing enrolled biometrics must invalidate the
///     previous credential" requirement, enforced by the OS rather than by
///     application code that could get it wrong.
///
/// Single account slot by design: this is a personal wage-tracking app with
/// no in-app account switching, so there is never more than one stored
/// credential at a time. Enabling biometrics for a different account
/// overwrites whatever was there — see `enable` below. The real
/// account-isolation guarantee is not this app-level bookkeeping though; it
/// is the Secure Enclave itself. `.biometryCurrentSet` means only a face/
/// fingerprint matching the device's *current* enrollment can ever unlock
/// the credential item, and every successful unlock is still re-validated
/// against the backend (see AppContext) before it is trusted — this plugin
/// only ever hands back a token, never a signed-in session.
@objc(BiometricAuth)
public class BiometricAuthPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "BiometricAuth"
  public let jsName = "BiometricAuth"
  public let pluginMethods: [CAPPluginMethod] = [
    .init(#selector(capabilities)),
    .init(#selector(isEnabled)),
    .init(#selector(enable)),
    .init(#selector(authenticate)),
    .init(#selector(disable))
  ]

  private let service = "com.ezazahmad.wagestracker.biometric"
  private let kMetaKey = "meta"
  private let kCredentialKey = "credential"

  // MARK: - capabilities

  /// Non-prompting hardware/enrollment check. `LAContext.biometryType` is
  /// only populated *after* `canEvaluatePolicy` has been called at least
  /// once (Apple's documented behavior), so that call always runs first even
  /// though its boolean result alone doesn't distinguish "no hardware" from
  /// "hardware present but nothing enrolled" — the `NSError` it fills in on
  /// failure does, and is what drives the disabled-with-explanation copy the
  /// Settings screen shows.
  @objc func capabilities(_ call: CAPPluginCall) {
    let context = LAContext()
    var evalError: NSError?
    let canEvaluate = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &evalError)

    let kind = biometryKindString(context.biometryType)

    if canEvaluate {
      call.resolve(["kind": kind, "enrolled": true])
      return
    }

    let (enrolled, reason) = describeUnavailable(evalError, kind: context.biometryType)
    call.resolve(["kind": kind, "enrolled": enrolled, "reason": reason])
  }

  private func biometryKindString(_ type: LABiometryType) -> String {
    switch type {
    case .faceID: return "faceId"
    case .touchID: return "touchId"
    default: return "none"
    }
  }

  /// Maps an `LAError` from `canEvaluatePolicy` to a user-facing explanation.
  /// `enrolled` distinguishes "the hardware exists but nothing is set up"
  /// (worth a "go enable it in Settings" message) from "there is no
  /// biometric hardware / it's restricted at all" (nothing to enable).
  private func describeUnavailable(_ error: NSError?, kind: LABiometryType) -> (enrolled: Bool, reason: String) {
    guard let laError = error as? LAError else {
      return (false, "Face ID or Touch ID isn't available on this device.")
    }
    switch laError.code {
    case .biometryNotEnrolled:
      let name = kind == .faceID ? "Face ID" : (kind == .touchID ? "Touch ID" : "Face ID or Touch ID")
      return (false, "\(name) is not set up on this device. Turn it on in iPhone Settings, then try again here.")
    case .biometryNotAvailable:
      return (false, "Face ID or Touch ID isn't available on this device.")
    case .passcodeNotSet:
      return (false, "Set a device passcode to use Face ID or Touch ID.")
    default:
      return (false, "Face ID or Touch ID isn't available right now.")
    }
  }

  // MARK: - isEnabled

  /// Reads only the non-secret metadata item — never triggers a biometric
  /// prompt. Used to decide, on every render, whether the Settings toggle
  /// should show as on and whether the login screen should show the icon at
  /// all, without asking the user to authenticate just to draw the UI.
  @objc func isEnabled(_ call: CAPPluginCall) {
    do {
      guard let data = try readItem(account: kMetaKey, requireBiometry: false, context: nil) else {
        call.resolve(["enabled": false])
        return
      }
      guard
        let meta = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let accountId = meta["accountId"] as? String,
        let kind = meta["kind"] as? String
      else {
        call.resolve(["enabled": false])
        return
      }
      call.resolve([
        "enabled": true,
        "accountId": accountId,
        "accountLabel": meta["accountLabel"] as? String ?? "",
        "kind": kind
      ])
    } catch {
      // A metadata read failure is not security-sensitive (there's no secret
      // in this item) — treat it the same as "not enabled" rather than
      // surfacing a Keychain error for a background UI check.
      call.resolve(["enabled": false])
    }
  }

  // MARK: - enable

  /// Prompts biometrics immediately, and only on success stores the given
  /// session token behind a fresh `.biometryCurrentSet`-protected Keychain
  /// item. Any previously-stored credential (this account's or a different
  /// one's, from before a logout that should have cleared it) is removed
  /// first, so there is never more than one stored credential and never a
  /// stale one left over from a prior account.
  @objc func enable(_ call: CAPPluginCall) {
    guard let accountId = call.getString("accountId"), !accountId.isEmpty else {
      call.reject("Missing accountId", "invalid_argument")
      return
    }
    guard let token = call.getString("token"), !token.isEmpty else {
      call.reject("Missing token", "invalid_argument")
      return
    }
    let accountLabel = call.getString("accountLabel") ?? ""

    let context = LAContext()
    let reason = "Enable Face ID to sign in to WagesTracker"

    context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { [weak self] success, error in
      guard let self else { return }
      DispatchQueue.main.async {
        guard success else {
          call.reject(self.describeLaError(error), self.laErrorCode(error))
          return
        }
        do {
          // Clear anything already stored — a stale credential (this
          // account's old one, or a different account's left over from a
          // logout path that should already have cleared it) must never
          // coexist with the one we're about to write.
          try self.deleteItem(account: self.kMetaKey)
          try self.deleteItem(account: self.kCredentialKey)

          let kind = self.biometryKindString(context.biometryType)
          let meta: [String: Any] = ["accountId": accountId, "accountLabel": accountLabel, "kind": kind]
          let metaData = try JSONSerialization.data(withJSONObject: meta)
          try self.writeItem(account: self.kMetaKey, data: metaData, requireBiometry: false)

          let credential: [String: Any] = ["accountId": accountId, "token": token]
          let credentialData = try JSONSerialization.data(withJSONObject: credential)
          try self.writeItem(account: self.kCredentialKey, data: credentialData, requireBiometry: true)

          call.resolve(["kind": kind])
        } catch {
          // Roll back a partial write (metadata saved but the credential
          // failed, or vice versa) so isEnabled() can never report "on" for
          // an account that has no usable credential behind it.
          try? self.deleteItem(account: self.kMetaKey)
          try? self.deleteItem(account: self.kCredentialKey)
          call.reject("Could not save the biometric credential.", "keychain_error")
        }
      }
    }
  }

  // MARK: - authenticate

  /// Prompts biometrics exactly once, then reuses that same authenticated
  /// `LAContext` to read the Keychain item via `kSecUseAuthenticationContext`
  /// — this fetch does not itself trigger a second prompt, because the
  /// context has already satisfied the access control's biometry
  /// requirement. That separation is what lets this method tell apart:
  ///   - user-level outcomes (cancel, wrong face, lockout, not enrolled) —
  ///     from the `evaluatePolicy` call itself, via `LAError`
  ///   - item-level outcomes (the credential is gone, or was silently
  ///     invalidated because the device's enrolled biometrics changed since
  ///     it was created) — from the Keychain read, which can still fail even
  ///     though the context is authenticated
  /// A `.biometryCurrentSet` item invalidated by a re-enrollment does not
  /// reliably surface a single distinct OSStatus across iOS versions, so
  /// both "the item is gone" and "the item is unreadable" are treated the
  /// same conservative way here: report `credential_invalidated` and delete
  /// whatever is left, rather than leave a half-broken credential around for
  /// the next launch to trip over again.
  @objc func authenticate(_ call: CAPPluginCall) {
    // Fail fast, before ever prompting, if nothing is enrolled — this is the
    // same non-prompting metadata check `isEnabled()` uses, so a caller that
    // got the "no credential" branch wrong (or a stale UI state) can't cause
    // a Face ID sheet to appear for an account with nothing stored behind it.
    guard (try? readItem(account: kMetaKey, requireBiometry: false, context: nil)) != nil else {
      call.reject("No biometric credential is stored on this device.", "not_enrolled")
      return
    }

    let context = LAContext()
    let reason = "Sign in to WagesTracker"

    context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { [weak self] success, error in
      guard let self else { return }
      DispatchQueue.main.async {
        guard success else {
          call.reject(self.describeLaError(error), self.laErrorCode(error))
          return
        }
        do {
          guard let data = try self.readItem(account: self.kCredentialKey, requireBiometry: true, context: context),
                let credential = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let token = credential["token"] as? String,
                let accountId = credential["accountId"] as? String
          else {
            self.invalidateStoredCredential()
            call.reject("The stored biometric credential is no longer valid.", "credential_invalidated")
            return
          }
          call.resolve(["token": token, "accountId": accountId])
        } catch {
          self.invalidateStoredCredential()
          call.reject("The stored biometric credential is no longer valid.", "credential_invalidated")
        }
      }
    }
  }

  private func invalidateStoredCredential() {
    try? deleteItem(account: kMetaKey)
    try? deleteItem(account: kCredentialKey)
  }

  // MARK: - disable

  /// Deletes both Keychain items unconditionally. Idempotent — disabling
  /// when nothing is stored is not an error, since every session-ending
  /// action in AppContext (logout, password change, current-session
  /// revocation, account deletion) calls this defensively regardless of
  /// whether biometrics was ever turned on.
  @objc func disable(_ call: CAPPluginCall) {
    do {
      try deleteItem(account: kMetaKey)
      try deleteItem(account: kCredentialKey)
      call.resolve()
    } catch {
      call.reject("Could not remove the stored biometric credential.", "keychain_error")
    }
  }

  // MARK: - LAError mapping

  private func laErrorCode(_ error: Error?) -> String {
    guard let laError = error as? LAError else { return "unknown_error" }
    switch laError.code {
    case .userCancel, .userFallback:
      return "user_cancelled"
    case .authenticationFailed:
      return "authentication_failed"
    case .biometryNotAvailable:
      return "unavailable"
    case .biometryNotEnrolled:
      return "not_enrolled"
    case .biometryLockout:
      return "lockout"
    case .appCancel, .systemCancel:
      // Covers the app being backgrounded mid-prompt (e.g. an incoming call,
      // the user switching apps) as well as the system dismissing the sheet
      // on its own. Neither is a real failure or cancellation the user made
      // a choice about — the caller must not clear the stored credential or
      // auto-retry for either, just fall back to the manual login screen.
      return "app_backgrounded"
    case .passcodeNotSet:
      return "unavailable"
    default:
      return "unknown_error"
    }
  }

  private func describeLaError(_ error: Error?) -> String {
    guard let laError = error as? LAError else { return "Biometric authentication failed." }
    switch laError.code {
    case .userCancel: return "Biometric authentication was cancelled."
    case .userFallback: return "Biometric authentication was cancelled."
    case .authenticationFailed: return "Face ID or Touch ID did not recognize you."
    case .biometryNotAvailable: return "Face ID or Touch ID isn't available on this device."
    case .biometryNotEnrolled: return "Face ID or Touch ID is not set up on this device."
    case .biometryLockout: return "Face ID or Touch ID is temporarily locked. Use your device passcode to unlock it, or sign in with your password."
    case .appCancel, .systemCancel: return "Biometric authentication was interrupted."
    case .passcodeNotSet: return "Set a device passcode to use Face ID or Touch ID."
    default: return "Biometric authentication failed."
    }
  }

  // MARK: - Keychain

  /// `requireBiometry` selects the access control: the metadata item never
  /// sets one (ordinary `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`,
  /// matching the rest of this app's Keychain items — see
  /// `nativeSecureTokenStorage.ts` on the JS side for the equivalent web/
  /// Remember-Me token), while the credential item is created with
  /// `.biometryCurrentSet` combined with `whenPasscodeSetThisDeviceOnly` —
  /// the strictest accessibility class, since a credential that unlocks a
  /// signed-in session should never be readable on a device with no passcode
  /// at all. `kSecUseAuthenticationContext` is deliberately omitted on write
  /// — creating a `.biometryCurrentSet` item does not itself require a
  /// biometric prompt, only reading it back does, which is what keeps
  /// `enable` to exactly one prompt.
  private func writeItem(account: String, data: Data, requireBiometry: Bool) throws {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecValueData as String: data
    ]

    if requireBiometry {
      var acErr: Unmanaged<CFError>?
      guard let access = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault,
        kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
        .biometryCurrentSet,
        &acErr
      ) else {
        throw KeychainOpError.osError
      }
      query[kSecAttrAccessControl as String] = access
    } else {
      query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    }

    SecItemDelete(query as CFDictionary)
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else { throw KeychainOpError.osError }
  }

  /// `context` is only ever non-nil for the credential item, and only after
  /// `evaluatePolicy` has already succeeded on it — reusing that context
  /// here (`kSecUseAuthenticationContext`) is what avoids a second prompt.
  private func readItem(account: String, requireBiometry: Bool, context: LAContext?) throws -> Data? {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne
    ]
    if requireBiometry, let context {
      query[kSecUseAuthenticationContext as String] = context
    }

    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw KeychainOpError.osError }
    return result as? Data
  }

  private func deleteItem(account: String) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account
    ]
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainOpError.osError }
  }
}

private enum KeychainOpError: Error {
  case osError
}
