/**
 * Shared, platform-neutral contract for biometric (Face ID / Touch ID)
 * login. Business logic — what a successful unlock actually means, whether
 * the recovered token is still good, what happens on a 401 — lives in
 * `AppContext`, exactly like every other adapter under `platform/`. This
 * file only defines the shape of "ask the platform" and "tell the platform",
 * plus the web no-op that keeps every non-native build (browser, installed
 * PWA) behaving exactly as it does today.
 *
 * Designed so a future Android adapter (Keystore-backed, same
 * BiometricPrompt-style flow) can implement `BiometricAuthAdapter` without
 * any change to AppContext, Settings or the login screen — see
 * `nativeBiometricAuth.ts` for the current iOS implementation.
 */

export type BiometryKind = "faceId" | "touchId" | "none";

export interface BiometricCapabilities {
  kind: BiometryKind;
  /** False when the hardware exists but nothing is enrolled, or when there
   * is no compatible hardware/passcode at all — see `reason`. */
  enrolled: boolean;
  /** Present whenever `enrolled` is false; drives the disabled-option
   * explanation in Settings. */
  reason?: string;
}

/** Non-prompting "is biometric login currently on, and for whom" read —
 * safe to call on every render (including the logged-out login screen) to
 * decide whether to show a toggle/icon at all. */
export interface BiometricStatus {
  enabled: boolean;
  accountId?: string;
  accountLabel?: string;
  kind?: BiometryKind;
}

/** Every distinguishable way a biometric prompt or credential lookup can
 * fail to produce a usable token — see the Swift plugin's `laErrorCode`/
 * reject-code mapping, which this mirrors 1:1 so nothing is lost in
 * translation at the JS boundary. */
export type BiometricFailureReason =
  | "user_cancelled"
  | "authentication_failed"
  | "unavailable"
  | "not_enrolled"
  | "lockout"
  | "app_backgrounded"
  | "credential_invalidated"
  | "keychain_error"
  | "unknown_error";

export interface BiometricEnableResult {
  outcome: "enabled" | "failed";
  kind?: BiometryKind;
  reason?: BiometricFailureReason;
  error?: string;
}

export interface BiometricAuthenticateResult {
  outcome: "success" | "failed";
  token?: string;
  accountId?: string;
  reason?: BiometricFailureReason;
  error?: string;
}

export interface BiometricAuthAdapter {
  checkCapabilities(): Promise<BiometricCapabilities>;
  getStatus(): Promise<BiometricStatus>;
  /** Prompts biometrics immediately (see the requirement this satisfies in
   * AppContext.enableBiometricLogin) and, only on success, stores `token`
   * behind a biometric-gated credential bound to `accountId`. */
  enable(accountId: string, accountLabel: string, token: string): Promise<BiometricEnableResult>;
  /** Prompts biometrics and, on success, returns the stored token. Never
   * throws for an ordinary cancellation/failure/lockout — those come back as
   * `{ outcome: "failed", reason }` so callers (the cold-launch auto-prompt
   * and the manual login-screen icon) can render a specific message instead
   * of a caught exception. */
  authenticate(): Promise<BiometricAuthenticateResult>;
  /** Deletes whatever credential is stored, unconditionally and without
   * prompting. Safe to call even when biometrics was never enabled — every
   * session-ending action in AppContext calls this defensively. */
  disable(): Promise<void>;
}

/** Web/PWA implementation: biometric login does not exist outside the
 * native iOS app, so every method reports "unavailable" rather than ever
 * touching a real API. Settings/AuthScreen use `checkCapabilities`/
 * `getStatus` to decide whether to render anything at all — on the web
 * these always say no, so no biometric control ever appears (see the
 * "Web/PWA: preserve existing authentication" requirement). */
class WebBiometricAuthAdapter implements BiometricAuthAdapter {
  async checkCapabilities(): Promise<BiometricCapabilities> {
    return {
      kind: "none",
      enrolled: false,
      reason: "Biometric login is only available in the WagesTracker iOS app.",
    };
  }

  async getStatus(): Promise<BiometricStatus> {
    return { enabled: false };
  }

  async enable(): Promise<BiometricEnableResult> {
    return {
      outcome: "failed",
      reason: "unavailable",
      error: "Biometric login is only available in the WagesTracker iOS app.",
    };
  }

  async authenticate(): Promise<BiometricAuthenticateResult> {
    return { outcome: "failed", reason: "unavailable" };
  }

  async disable(): Promise<void> {}
}

let activeAdapter: BiometricAuthAdapter | undefined;

function adapter(): BiometricAuthAdapter {
  activeAdapter ??= new WebBiometricAuthAdapter();
  return activeAdapter;
}

/** Native startup (see main.tsx) swaps this for `NativeBiometricAuthAdapter`
 * on an iOS build, mirroring `configureTokenStorage`/`configurePdfDelivery`. */
export function configureBiometricAuth(next: BiometricAuthAdapter): void {
  activeAdapter = next;
}

export function checkBiometricCapabilities(): Promise<BiometricCapabilities> {
  return adapter().checkCapabilities();
}

export function getBiometricStatus(): Promise<BiometricStatus> {
  return adapter().getStatus();
}

export function enableBiometricLogin(
  accountId: string,
  accountLabel: string,
  token: string
): Promise<BiometricEnableResult> {
  return adapter().enable(accountId, accountLabel, token);
}

export function authenticateWithBiometrics(): Promise<BiometricAuthenticateResult> {
  return adapter().authenticate();
}

export function disableBiometricLogin(): Promise<void> {
  return adapter().disable();
}
