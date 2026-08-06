/** Build-time constants injected by vite.config.ts — always reflect the
 * exact commit and moment a given build was produced, no manual bumping
 * required. `APP_VERSION` alone is a human-friendly milestone number bumped
 * by hand in package.json; combined with the hash it's also provably tied
 * to exact source, which is what actually answers "is this the build I
 * just pushed". */
export const APP_VERSION = __APP_VERSION__;
export const BUILD_HASH = __BUILD_HASH__;
export const BUILD_DATE = __BUILD_DATE__;

const buildDateLabel = (() => {
  const d = new Date(BUILD_DATE);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
})();

/** e.g. "v1.0.0 (92e9e57) · Aug 6, 2026" — used in Settings. */
export const VERSION_LABEL = `v${APP_VERSION} (${BUILD_HASH})${buildDateLabel ? ` · ${buildDateLabel}` : ""}`;

/** e.g. "v1.0.0 (92e9e57)" — no date, for contexts (like the PDF footer)
 * that already show a date of their own nearby. */
export const VERSION_SHORT = `v${APP_VERSION} (${BUILD_HASH})`;
