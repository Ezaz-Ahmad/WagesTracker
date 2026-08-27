/** Native Universal Link routing for password recovery. Tokens remain only
 * in memory and are never logged or written to device storage. */
export type DeepLinkRoute = { screen: "reset-password"; token: string };

let current: DeepLinkRoute | null = null;
const listeners = new Set<(route: DeepLinkRoute | null) => void>();
const RESET_LINK_HOST = "wages-tracker-frontend.vercel.app";
const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function publish(route: DeepLinkRoute | null): void {
  current = route;
  for (const listener of listeners) listener(route);
}

export function parseDeepLink(rawUrl: string): DeepLinkRoute | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== RESET_LINK_HOST) return null;
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path !== "/reset-password") return null;
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    const token = fragment.get("token");
    if (!token || !RESET_TOKEN_PATTERN.test(token)) return null;
    return { screen: "reset-password", token };
  } catch {
    return null;
  }
}

export function handleIncomingUrl(rawUrl: string): boolean {
  const route = parseDeepLink(rawUrl);
  if (!route) return false;
  publish(route);
  return true;
}

export function getDeepLink(): DeepLinkRoute | null {
  return current;
}

export function clearDeepLink(): void {
  publish(null);
}

export function subscribeDeepLink(listener: (route: DeepLinkRoute | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function startDeepLinkListener(): Promise<void> {
  try {
    const { App } = await import("@capacitor/app");
    await App.addListener("appUrlOpen", ({ url }: { url: string }) => {
      handleIncomingUrl(url);
    });
    const launch = await App.getLaunchUrl();
    if (launch?.url) handleIncomingUrl(launch.url);
  } catch {
    // Deep-link registration must never prevent an ordinary app launch. No
    // error object is logged because native errors can contain the URL.
    console.error("Could not start the password-recovery deep-link listener.");
  }
}

export function resetDeepLinksForTests(): void {
  current = null;
  listeners.clear();
}
