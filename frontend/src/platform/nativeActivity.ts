let activeOperations = 0;
let suppressUntil = 0;

export const NATIVE_ACTIVITY_GRACE_MS = 750;

/** The iOS share sheet makes the app inactive temporarily. Lifecycle refreshes
 * during that system-owned interaction are noise, not a genuine app resume. */
export async function duringNativeActivity<T>(operation: () => Promise<T>): Promise<T> {
  activeOperations += 1;
  try {
    return await operation();
  } finally {
    activeOperations = Math.max(0, activeOperations - 1);
    suppressUntil = Date.now() + NATIVE_ACTIVITY_GRACE_MS;
  }
}

export function isNativeActivityInProgress(now: number = Date.now()): boolean {
  return activeOperations > 0 || now < suppressUntil;
}

export function resetNativeActivityForTests(): void {
  activeOperations = 0;
  suppressUntil = 0;
}
