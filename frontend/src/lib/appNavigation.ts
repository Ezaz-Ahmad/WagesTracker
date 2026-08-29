export const APP_NAVIGATION_EVENT = "wage-tracker:navigation";

export type PublicAppPath = "/privacy" | "/support";

let returnFocusElement: HTMLElement | null = null;

export function normaliseAppPath(pathname = window.location.pathname): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export function isPublicAppPath(pathname: string): pathname is PublicAppPath {
  return pathname === "/privacy" || pathname === "/support";
}

export function rememberAppReturnFocus(element: HTMLElement | null): void {
  returnFocusElement = element;
}

export function restoreAppReturnFocus(): void {
  const element = returnFocusElement;
  returnFocusElement = null;
  if (!element?.isConnected) return;
  requestAnimationFrame(() => element.focus({ preventScroll: true }));
}

export function navigateWithinApp(path: string, options: { replace?: boolean } = {}): void {
  const currentPath = normaliseAppPath();
  if (currentPath === path) return;
  const currentState = window.history.state ?? {};
  const returnDepth = isPublicAppPath(currentPath) && currentState.wageTrackerInternalPage
    ? Number(currentState.wageTrackerReturnDepth || 1) + 1
    : 1;
  const state = isPublicAppPath(path)
    ? { ...currentState, wageTrackerInternalPage: true, wageTrackerReturnDepth: returnDepth }
    : currentState;
  const method = options.replace ? "replaceState" : "pushState";
  window.history[method](state, "", path);
  window.dispatchEvent(new Event(APP_NAVIGATION_EVENT));
}

export function returnToWageTracker(): void {
  if (window.history.state?.wageTrackerInternalPage) {
    window.history.go(-Number(window.history.state.wageTrackerReturnDepth || 1));
    return;
  }
  navigateWithinApp("/", { replace: true });
}
