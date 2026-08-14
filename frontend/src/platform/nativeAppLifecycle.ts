import { App, type AppState } from "@capacitor/app";
import type { AppLifecycleAdapter } from "./appLifecycle";

export class NativeAppLifecycleAdapter implements AppLifecycleAdapter {
  async addResumeListener(listener: () => void): Promise<{ remove(): Promise<void> }> {
    let lastNotification = 0;
    const notifyOnce = () => {
      const now = Date.now();
      if (now - lastNotification < 500) return;
      lastNotification = now;
      listener();
    };
    const [stateHandle, resumeHandle] = await Promise.all([
      App.addListener("appStateChange", (state: AppState) => { if (state.isActive) notifyOnce(); }),
      App.addListener("resume", notifyOnce),
    ]);
    return { remove: async () => {
      await Promise.all([stateHandle.remove(), resumeHandle.remove()]);
    } };
  }
}
