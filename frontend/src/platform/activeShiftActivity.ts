/** Platform-neutral contract for the native active-shift surface. */
export interface ActiveShiftActivityInfo {
  shiftId: string;
  apiBaseUrl: string;
  clockOutToken: string;
  startedAtEpochMs: number;
  location: string;
}

export type ActiveShiftActivityStartResult =
  | { status: "active"; pendingClockOut: boolean; completionNotifications: "authorized" | "denied" | "notDetermined" }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; error: string };

export interface ActiveShiftEndedEvent {
  shiftId: string;
  finalDurationSeconds: number;
}

export interface ActiveShiftActivityAdapter {
  startOrUpdate(info: ActiveShiftActivityInfo): Promise<ActiveShiftActivityStartResult>;
  /** Removes the system surface without ending the work shift or discarding
   * an already-confirmed offline clock-out request. */
  dismiss(): Promise<void>;
  end(options: { shiftId?: string; finalDurationSeconds?: number }): Promise<void>;
  retryPendingClockOut(): Promise<{ queued: boolean }>;
  subscribeEnded(listener: (event: ActiveShiftEndedEvent) => void): Promise<() => void>;
}

class WebActiveShiftActivityAdapter implements ActiveShiftActivityAdapter {
  async startOrUpdate(): Promise<ActiveShiftActivityStartResult> {
    return { status: "unavailable", reason: "Native active-shift activities are not available in a web browser." };
  }
  async dismiss(): Promise<void> {}
  async end(): Promise<void> {}
  async retryPendingClockOut(): Promise<{ queued: boolean }> { return { queued: false }; }
  async subscribeEnded(): Promise<() => void> { return () => {}; }
}

let activeAdapter: ActiveShiftActivityAdapter = new WebActiveShiftActivityAdapter();
let configured = false;

export function configureActiveShiftActivity(adapter: ActiveShiftActivityAdapter): void {
  activeAdapter = adapter;
  configured = true;
}

/** Avoids issuing native-only clock-out credentials in web/PWA sessions. */
export function isActiveShiftActivityConfigured(): boolean {
  return configured;
}

export function startOrUpdateActiveShiftActivity(info: ActiveShiftActivityInfo): Promise<ActiveShiftActivityStartResult> {
  return activeAdapter.startOrUpdate(info);
}

export function endActiveShiftActivity(options: { shiftId?: string; finalDurationSeconds?: number } = {}): Promise<void> {
  return activeAdapter.end(options);
}

export function dismissActiveShiftActivity(): Promise<void> {
  return activeAdapter.dismiss();
}

export function retryPendingActiveShiftClockOut(): Promise<{ queued: boolean }> {
  return activeAdapter.retryPendingClockOut();
}

export function subscribeActiveShiftEnded(listener: (event: ActiveShiftEndedEvent) => void): Promise<() => void> {
  return activeAdapter.subscribeEnded(listener);
}

/** Test isolation for suites that install a fake native adapter. */
export function resetActiveShiftActivityForTests(): void {
  activeAdapter = new WebActiveShiftActivityAdapter();
  configured = false;
}
