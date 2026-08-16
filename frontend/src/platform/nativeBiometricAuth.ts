import { registerPlugin } from "@capacitor/core";
import type {
  BiometricAuthAdapter,
  BiometricAuthenticateResult,
  BiometricCapabilities,
  BiometricEnableResult,
  BiometricFailureReason,
  BiometricStatus,
  BiometryKind,
} from "./biometricAuth";

/**
 * Raw shape of the native `BiometricAuthPlugin.swift` bridge (see
 * `ios/App/App/BiometricAuthPlugin.swift`). There is no npm package for this
 * plugin — it is app-local Swift compiled directly into the App target, the
 * same "custom native code" mechanism Capacitor documents for plugins that
 * only ever need to exist inside one app. `registerPlugin` below is exactly
 * how the official Capacitor plugins the rest of this codebase uses (Share,
 * Filesystem, Network, App) are implemented internally; the only difference
 * here is that there's no published wrapper package because there's nothing
 * to publish.
 */
export interface BiometricAuthPluginPort {
  capabilities(): Promise<{ kind: BiometryKind; enrolled: boolean; reason?: string }>;
  isEnabled(): Promise<{ enabled: boolean; accountId?: string; accountLabel?: string; email?: string; kind?: BiometryKind }>;
  enable(options: { accountId: string; accountLabel: string; email: string; token: string }): Promise<{ kind: BiometryKind }>;
  authenticate(): Promise<{ token: string; accountId: string }>;
  disable(): Promise<void>;
}

const BiometricAuthPlugin = registerPlugin<BiometricAuthPluginPort>("BiometricAuth");

const KNOWN_FAILURE_REASONS: readonly BiometricFailureReason[] = [
  "user_cancelled",
  "authentication_failed",
  "unavailable",
  "not_enrolled",
  "lockout",
  "app_backgrounded",
  "credential_invalidated",
  "keychain_error",
  "unknown_error",
];

/** Capacitor's iOS bridge carries the native `call.reject(message, code)`
 * call's second argument through as `.code` on the rejected JS error — this
 * is what lets a cancelled Face ID prompt be told apart from a genuine
 * failure without parsing free-text messages. Falls back to "unknown_error"
 * for anything unrecognized (a future Swift-side code this file hasn't been
 * updated for, or a non-plugin error) rather than guessing. */
function reasonFromError(error: unknown): BiometricFailureReason {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string" && (KNOWN_FAILURE_REASONS as readonly string[]).includes(code)) {
    return code as BiometricFailureReason;
  }
  return "unknown_error";
}

function messageFromError(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

/** Native implementation of the shared biometric-login contract. Every
 * method is a thin translation from the plugin's raw resolve/reject shape
 * into the typed result AppContext consumes — no session/token decisions
 * happen here, only "what did the platform say." */
export class NativeBiometricAuthAdapter implements BiometricAuthAdapter {
  constructor(private readonly plugin: BiometricAuthPluginPort = BiometricAuthPlugin) {}

  checkCapabilities(): Promise<BiometricCapabilities> {
    return this.plugin.capabilities();
  }

  getStatus(): Promise<BiometricStatus> {
    return this.plugin.isEnabled();
  }

  async enable(accountId: string, accountLabel: string, email: string, token: string): Promise<BiometricEnableResult> {
    try {
      const { kind } = await this.plugin.enable({ accountId, accountLabel, email, token });
      return { outcome: "enabled", kind };
    } catch (error) {
      return { outcome: "failed", reason: reasonFromError(error), error: messageFromError(error) };
    }
  }

  async authenticate(): Promise<BiometricAuthenticateResult> {
    try {
      const { token, accountId } = await this.plugin.authenticate();
      return { outcome: "success", token, accountId };
    } catch (error) {
      return { outcome: "failed", reason: reasonFromError(error), error: messageFromError(error) };
    }
  }

  async disable(): Promise<void> {
    // Best-effort, same reasoning as AppContext's clearTokenSafely for the
    // existing token adapter: every caller here is already inside a
    // cleanup path (logout, password change, account deletion) that must
    // complete even if the native Keychain delete itself fails.
    try {
      await this.plugin.disable();
    } catch (error) {
      console.error("Could not clear the stored biometric credential", error);
    }
  }
}
