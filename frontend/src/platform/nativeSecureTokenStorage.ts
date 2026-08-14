import {
  KeychainAccess,
  SecureStorage,
  type SecureStoragePlugin,
} from "@aparajita/capacitor-secure-storage";
import type { TokenStorageAdapter } from "./tokenStorage";

const TOKEN_KEY = "session";
const KEY_PREFIX = "com.ezazahmad.wagestracker.auth.";

interface StoredSession {
  token: string;
  remembered: boolean;
}

type SecureStore = Pick<
  SecureStoragePlugin,
  | "getItem"
  | "removeItem"
  | "setDefaultKeychainAccess"
  | "setItem"
  | "setKeyPrefix"
  | "setSynchronize"
>;

function decodeSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof value.token !== "string" || !value.token || typeof value.remembered !== "boolean") {
      return null;
    }
    return { token: value.token, remembered: value.remembered };
  } catch {
    return null;
  }
}

/** Native implementation of the shared authentication-storage contract.
 * Remembered iOS sessions use Keychain; unchecked sessions remain in memory
 * only. The same adapter can use Android Keystore later without changing
 * authentication or React code. */
export class NativeSecureTokenStorageAdapter implements TokenStorageAdapter {
  private session: StoredSession | null = null;

  constructor(private readonly secureStore: SecureStore = SecureStorage) {}

  async initialize(): Promise<void> {
    await this.secureStore.setKeyPrefix(KEY_PREFIX);
    await this.secureStore.setSynchronize(false);
    await this.secureStore.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);

    const raw = await this.secureStore.getItem(TOKEN_KEY);
    const persisted = decodeSession(raw);
    this.session = persisted?.remembered ? persisted : null;
    if (raw && !this.session) {
      await this.secureStore.removeItem(TOKEN_KEY);
    }
  }

  getToken(): string | null {
    return this.session?.token ?? null;
  }

  async setToken(token: string, remember: boolean): Promise<void> {
    const next = { token, remembered: remember };
    if (remember) {
      await this.secureStore.setItem(TOKEN_KEY, JSON.stringify(next));
    } else {
      // Match the web sessionStorage contract: an unchecked session exists
      // only in memory and cannot survive a native process restart.
      await this.secureStore.removeItem(TOKEN_KEY);
    }
    this.session = next;
  }

  async clearToken(): Promise<void> {
    await this.secureStore.removeItem(TOKEN_KEY);
    this.session = null;
  }

  isRemembered(): boolean {
    return this.session?.remembered ?? false;
  }
}
