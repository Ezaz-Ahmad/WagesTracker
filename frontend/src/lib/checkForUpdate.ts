/**
 * Compares the app bundle already running in this tab against whatever is
 * actually deployed right now, and does a real page reload if they differ —
 * so pulling to refresh on Home doesn't just get fresh *data*, it also picks
 * up any new code that's been pushed since this tab was opened, without
 * forcing a jarring full-page reload on every single pull (only when there
 * genuinely is something new).
 *
 * Vite gives every build's JS file a content hash in its filename, so any
 * real code change produces a different `<script src>` in a freshly-fetched
 * index.html. An unchanged deploy compares equal and is a silent no-op.
 */
export async function reloadIfNewVersionDeployed(): Promise<void> {
  try {
    const currentSrc = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.src;
    if (!currentSrc) return;

    const res = await fetch(`/index.html?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const html = await res.text();
    const match = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/);
    const latestSrc = match?.[1];
    if (!latestSrc) return;

    const latestAbsolute = new URL(latestSrc, window.location.origin).href;
    if (latestAbsolute !== currentSrc) {
      window.location.reload();
    }
  } catch {
    // A network hiccup here is a silent no-op — the data half of the
    // refresh already ran (or failed) independently of this check, and
    // there's nothing more useful to do than let the next pull try again.
  }
}
