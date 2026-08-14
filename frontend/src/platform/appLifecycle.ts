import { isNativeActivityInProgress } from "./nativeActivity";

export interface AppLifecycleAdapter {
  addResumeListener(listener: () => void): Promise<{ remove(): Promise<void> | void }>;
}

let adapter: AppLifecycleAdapter | null = null;

export function configureAppLifecycleAdapter(next: AppLifecycleAdapter): void {
  adapter = next;
}

export function subscribeAppResume(listener: () => void): () => void {
  if (!adapter) return () => {};
  let disposed = false;
  let handle: { remove(): Promise<void> | void } | undefined;
  void adapter.addResumeListener(() => {
    if (!disposed && !isNativeActivityInProgress()) listener();
  }).then((next) => {
    if (disposed) void next.remove();
    else handle = next;
  }).catch((error) => console.warn("Could not observe application lifecycle", error));
  return () => {
    disposed = true;
    if (handle) void handle.remove();
  };
}
