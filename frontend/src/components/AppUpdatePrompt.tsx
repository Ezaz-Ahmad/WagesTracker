import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../lib/useFocusTrap";
import { subscribeAppResume } from "../platform/appLifecycle";
import { APP_STORE_URL, checkForAppUpdate, dismissAppUpdate, nextAppUpdateCheckDelay, type AvailableAppUpdate } from "../platform/appUpdates";
import { Logo } from "./Logo";

export function AppUpdatePrompt({ enabled }: { enabled: boolean }) {
  const [candidate, setCandidate] = useState<AvailableAppUpdate | null>(null);
  const [visible, setVisible] = useState(false);
  const updateRef = useRef<HTMLAnchorElement>(null);
  const dismiss = () => {
    if (candidate) dismissAppUpdate(candidate.latestVersion);
    setVisible(false);
    setCandidate(null);
  };
  const trapRef = useFocusTrap<HTMLDivElement>(enabled && visible, dismiss, updateRef);

  useEffect(() => {
    if (!enabled) { setVisible(false); setCandidate(null); return; }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isForeground = () => document.visibilityState === "visible";
    const check = async () => {
      clearTimeout(timer);
      if (!isForeground()) return;
      const update = await checkForAppUpdate();
      if (disposed) return;
      setCandidate(update);
      if (!update) setVisible(false);
      // Coalesced launch/resume events must leave only one foreground timer.
      clearTimeout(timer);
      const delay = nextAppUpdateCheckDelay();
      if (delay !== null && isForeground()) {
        timer = setTimeout(() => { void check(); }, delay);
      }
    };
    void check();
    const unsubscribe = subscribeAppResume(() => { void check(); });
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
      else clearTimeout(timer);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);

  // A shift action or account dialog already being used takes priority.
  useEffect(() => {
    if (!enabled || !candidate || visible) return;
    const offer = () => {
      if (document.visibilityState === "hidden") return;
      const busy = Array.from(document.querySelectorAll('[aria-modal="true"]'))
        .some((element) => !element.closest('[hidden], [aria-hidden="true"]'));
      if (!busy) setVisible(true);
    };
    const observer = new MutationObserver(offer);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "aria-hidden", "aria-modal"] });
    document.addEventListener("visibilitychange", offer);
    offer();
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", offer); };
  }, [enabled, candidate, visible]);

  if (!enabled || !visible || !candidate) return null;
  return createPortal(
    <div className="confirm-backdrop app-update-backdrop" onClick={dismiss}>
      <div ref={trapRef} className="confirm-modal app-update-dialog" role="dialog" aria-modal="true"
        aria-labelledby="app-update-title" aria-describedby="app-update-description" tabIndex={-1}
        onClick={(event) => event.stopPropagation()}>
        <div className="app-update-brand"><Logo size={56} /><span>Wages Tracker</span></div>
        <span className="app-update-eyebrow">New version available</span>
        <h2 id="app-update-title">An update is ready</h2>
        <p id="app-update-description">Wages Tracker <strong>{candidate.latestVersion}</strong> is now available.
          Update from the App Store to get the latest improvements.</p>
        <div className="app-update-version"><span>Installed {candidate.installedVersion}</span><span aria-hidden="true">→</span><strong>Latest {candidate.latestVersion}</strong></div>
        <div className="confirm-modal-actions app-update-actions">
          <a ref={updateRef} className="confirm-action-btn app-update-primary" href={APP_STORE_URL}
            target="_blank" rel="noopener noreferrer" onClick={dismiss}>Update now</a>
          <button type="button" className="confirm-action-btn app-update-later" onClick={dismiss}>Not now</button>
        </div>
      </div>
    </div>, document.body,
  );
}
