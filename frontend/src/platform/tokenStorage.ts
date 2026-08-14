export interface TokenStorageAdapter {
  /** Hydrates any platform cache before authenticated API work begins. */
  initialize(): Promise<void>;
  getToken(): string | null;
  setToken(token: string, remember: boolean): Promise<void>;
  clearToken(): Promise<void>;
  isRemembered(): boolean;
}

const TOKEN_KEY = "wageTracker.token";

/** Browser implementation. Its storage choices intentionally preserve the
 * existing Remember Me contract: localStorage survives a browser restart,
 * while sessionStorage lasts only for the current tab/browser session. */
export class WebTokenStorageAdapter implements TokenStorageAdapter {
  constructor(
    private readonly persistentStorage: Storage,
    private readonly sessionOnlyStorage: Storage
  ) {}

  async initialize(): Promise<void> {}

  getToken(): string | null {
    return this.persistentStorage.getItem(TOKEN_KEY) ?? this.sessionOnlyStorage.getItem(TOKEN_KEY);
  }

  async setToken(token: string, remember: boolean): Promise<void> {
    if (remember) {
      this.persistentStorage.setItem(TOKEN_KEY, token);
      this.sessionOnlyStorage.removeItem(TOKEN_KEY);
    } else {
      this.sessionOnlyStorage.setItem(TOKEN_KEY, token);
      this.persistentStorage.removeItem(TOKEN_KEY);
    }
  }

  async clearToken(): Promise<void> {
    this.persistentStorage.removeItem(TOKEN_KEY);
    this.sessionOnlyStorage.removeItem(TOKEN_KEY);
  }

  isRemembered(): boolean {
    return this.persistentStorage.getItem(TOKEN_KEY) !== null;
  }
}

let activeAdapter: TokenStorageAdapter | undefined;

function adapter(): TokenStorageAdapter {
  activeAdapter ??= new WebTokenStorageAdapter(localStorage, sessionStorage);
  return activeAdapter;
}

export function configureTokenStorage(next: TokenStorageAdapter): void {
  activeAdapter = next;
}

export function initializeTokenStorage(): Promise<void> {
  return adapter().initialize();
}

export function getStoredToken(): string | null {
  return adapter().getToken();
}

export function storeToken(token: string, remember: boolean): Promise<void> {
  return adapter().setToken(token, remember);
}

export function removeStoredToken(): Promise<void> {
  return adapter().clearToken();
}

export function isStoredTokenRemembered(): boolean {
  return adapter().isRemembered();
}
