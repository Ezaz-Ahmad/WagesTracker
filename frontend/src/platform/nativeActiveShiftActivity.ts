import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type {
  ActiveShiftActivityAdapter,
  ActiveShiftActivityInfo,
  ActiveShiftActivityStartResult,
  ActiveShiftEndedEvent,
} from "./activeShiftActivity";

export interface ActiveShiftActivityPluginPort {
  startOrUpdate(options: ActiveShiftActivityInfo): Promise<ActiveShiftActivityStartResult>;
  dismiss(): Promise<void>;
  end(options: { shiftId?: string; finalDurationSeconds?: number }): Promise<void>;
  retryPendingClockOut(): Promise<{ queued: boolean }>;
  addListener(
    eventName: "shiftEnded",
    listener: (event: ActiveShiftEndedEvent) => void
  ): Promise<PluginListenerHandle>;
}

const ActiveShiftActivityPlugin = registerPlugin<ActiveShiftActivityPluginPort>("ActiveShiftActivity");

/** Thin, failure-contained translation around the app-local Swift plugin. */
export class NativeActiveShiftActivityAdapter implements ActiveShiftActivityAdapter {
  constructor(private readonly plugin: ActiveShiftActivityPluginPort = ActiveShiftActivityPlugin) {}

  async startOrUpdate(info: ActiveShiftActivityInfo): Promise<ActiveShiftActivityStartResult> {
    try {
      return await this.plugin.startOrUpdate(info);
    } catch (error) {
      console.error("Could not start the active-shift Live Activity", error);
      return { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }

  async dismiss(): Promise<void> {
    try {
      await this.plugin.dismiss();
    } catch (error) {
      console.error("Could not dismiss the active-shift Live Activity", error);
    }
  }

  async end(options: { shiftId?: string; finalDurationSeconds?: number }): Promise<void> {
    try {
      await this.plugin.end(options);
    } catch (error) {
      console.error("Could not end the active-shift Live Activity", error);
    }
  }

  async retryPendingClockOut(): Promise<{ queued: boolean }> {
    try {
      return await this.plugin.retryPendingClockOut();
    } catch (error) {
      console.error("Could not retry the pending native clock-out", error);
      return { queued: false };
    }
  }

  async subscribeEnded(listener: (event: ActiveShiftEndedEvent) => void): Promise<() => void> {
    const handle = await this.plugin.addListener("shiftEnded", listener);
    return () => { void handle.remove(); };
  }
}
