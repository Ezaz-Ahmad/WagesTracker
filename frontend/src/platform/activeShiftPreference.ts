const ACTIVE_SHIFT_PREFERENCE_PREFIX = "wagesTracker.activeShiftActivity.enabled.v1:";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): PreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function keyFor(accountId: string): string {
  return `${ACTIVE_SHIFT_PREFERENCE_PREFIX}${accountId}`;
}

/**
 * This preference is intentionally per account and per installation. A Live
 * Activity is a device surface, so enabling it on one iPhone must not silently
 * enable notifications on every other signed-in device. Missing/invalid
 * storage always fails closed to the product default: off.
 */
export function readActiveShiftPreference(
  accountId: string,
  storage: PreferenceStorage | null = browserStorage()
): boolean {
  if (!accountId || !storage) return false;
  try {
    return storage.getItem(keyFor(accountId)) === "on";
  } catch {
    return false;
  }
}

export function writeActiveShiftPreference(
  accountId: string,
  enabled: boolean,
  storage: PreferenceStorage | null = browserStorage()
): void {
  if (!accountId || !storage) return;
  try {
    storage.setItem(keyFor(accountId), enabled ? "on" : "off");
  } catch {
    // A storage failure must never break Settings or starting a shift. The
    // in-memory choice still applies until the app process ends, then safely
    // returns to the default-off state.
  }
}
