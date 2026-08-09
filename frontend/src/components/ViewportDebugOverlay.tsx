import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APP_VERSION, BUILD_DATE, BUILD_HASH } from "../lib/appVersion";
import {
  getViewportDiagnostics,
  subscribeViewportDiagnostics,
  type ViewportDiagnostics,
} from "../lib/viewportHeight";

/**
 * Temporary on-device diagnostics for the installed-iPhone-PWA viewport bug.
 *
 * Only ever mounted when the build was made with `VITE_VIEWPORT_DEBUG=true`
 * (see App.tsx) — the normal production build folds the flag to `false`, the
 * JSX branch disappears, and this module is tree-shaken out of the bundle
 * entirely. It exists so a real iPhone can report what the viewport
 * lifecycle actually did, since none of it is reproducible off-device.
 *
 * Nothing here reads user data: no field values, no email, no token, no
 * session id. The focused element is reported by tag and input *type* only
 * (`input[type=password]`), never by name, id, or contents.
 */

const REFRESH_MS = 250;

function n(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return String(Math.round(value * 100) / 100);
}

function formatDiagnostics(d: ViewportDiagnostics): string {
  const lines = [
    `Wage Tracker viewport diagnostics`,
    `version           v${APP_VERSION} (${BUILD_HASH})`,
    `build date        ${BUILD_DATE}`,
    `captured          ${new Date().toISOString()}`,
    ``,
    `standalone PWA    ${d.standalone}`,
    `soft keyboard     ${d.softKeyboardCapable}`,
    ``,
    `innerHeight       ${n(d.innerHeight)}`,
    `clientHeight      ${n(d.clientHeight)}`,
    `vv.height         ${n(d.visualViewportHeight)}`,
    `vv.offsetTop      ${n(d.visualViewportOffsetTop)}`,
    `keyboard inset    ${n(d.keyboardInset)}`,
    ``,
    `--app-viewport-height  ${n(d.publishedHeight)}`,
    `baseline               ${n(d.baseline)}`,
    `candidate              ${n(d.candidateHeight)}`,
    ``,
    `editable focused  ${d.editableFocused}`,
    `focused element   ${d.focusedElement}`,
    `recovery active   ${d.recoveryActive}${d.recoverySource ? ` (${d.recoverySource})` : ""}`,
    `recovery held ms  ${n(d.recoveryHeldMs)}`,
    `orientation flux  ${d.orientationInFlux}`,
    `last decision     ${d.lastDecision ? `${d.lastDecision.publish ? "publish" : "hold"} ${n(d.lastDecision.height)} — ${d.lastDecision.reason}` : "—"}`,
    `last settle       ${d.lastSettle ? `${d.lastSettle.reason} published=${n(d.lastSettle.publishedHeight)} baseline=${n(d.lastSettle.baseline)} in ${d.lastSettle.elapsedMs}ms` : "—"}`,
    ``,
    `events (most recent last):`,
    ...d.events.map((e) => `  ${new Date(e.at).toISOString().slice(11, 23)}  ${e.kind.padEnd(10)} ${e.detail}`),
  ];
  return lines.join("\n");
}

export function ViewportDebugOverlay() {
  const [diagnostics, setDiagnostics] = useState<ViewportDiagnostics>(() => getViewportDiagnostics());
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const tick = () => setDiagnostics(getViewportDiagnostics());
    const interval = setInterval(tick, REFRESH_MS);
    const unsubscribe = subscribeViewportDiagnostics(tick);
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  const report = useMemo(() => formatDiagnostics(diagnostics), [diagnostics]);

  const copy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(report);
      } else {
        // iOS in standalone mode occasionally refuses the async clipboard;
        // the old selection API still works from a user gesture.
        const area = textRef.current;
        if (!area) throw new Error("no fallback target");
        area.select();
        area.setSelectionRange(0, report.length);
        document.execCommand("copy");
      }
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied("idle"), 2000);
  }, [report]);

  const rows: [string, string][] = [
    ["standalone", String(diagnostics.standalone)],
    ["innerHeight", n(diagnostics.innerHeight)],
    ["clientHeight", n(diagnostics.clientHeight)],
    ["vv.height", n(diagnostics.visualViewportHeight)],
    ["vv.offsetTop", n(diagnostics.visualViewportOffsetTop)],
    ["kbd inset", n(diagnostics.keyboardInset)],
    ["published", n(diagnostics.publishedHeight)],
    ["baseline", n(diagnostics.baseline)],
    ["candidate", n(diagnostics.candidateHeight)],
    ["focus", diagnostics.focusedElement],
    ["editable", String(diagnostics.editableFocused)],
    ["guard", diagnostics.recoveryActive ? `on (${diagnostics.recoverySource}, ${n(diagnostics.recoveryHeldMs)}ms)` : "off"],
    ["decision", diagnostics.lastDecision ? `${diagnostics.lastDecision.publish ? "set" : "hold"} ${diagnostics.lastDecision.reason}` : "—"],
    ["settle", diagnostics.lastSettle ? `${diagnostics.lastSettle.reason} → ${n(diagnostics.lastSettle.publishedHeight)}` : "—"],
    ["version", `v${APP_VERSION} (${BUILD_HASH})`],
  ];

  return (
    <div
      style={{
        position: "fixed",
        left: 6,
        top: "calc(env(safe-area-inset-top, 0px) + 6px)",
        zIndex: 2147483647,
        maxWidth: "min(94vw, 360px)",
        maxHeight: collapsed ? "auto" : "58vh",
        overflowY: "auto",
        background: "rgba(12,12,14,0.92)",
        color: "#e9e9ee",
        font: "600 10px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
        border: "1px solid rgba(255,255,255,0.22)",
        borderRadius: 10,
        padding: 8,
        pointerEvents: "auto",
        WebkitBackdropFilter: "blur(8px)",
        backdropFilter: "blur(8px)",
      }}
      role="status"
      aria-label="Viewport diagnostics"
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
        <strong style={{ flex: 1, fontSize: 11 }}>viewport debug</strong>
        <button type="button" onClick={copy} style={buttonStyle}>
          {copied === "ok" ? "copied" : copied === "fail" ? "failed" : "copy"}
        </button>
        <button type="button" onClick={() => setCollapsed((c) => !c)} style={buttonStyle}>
          {collapsed ? "show" : "hide"}
        </button>
      </div>

      {!collapsed && (
        <>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label}>
                  <td style={{ opacity: 0.65, paddingRight: 8, whiteSpace: "nowrap" }}>{label}</td>
                  <td style={{ textAlign: "right", wordBreak: "break-word" }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 6, opacity: 0.65 }}>events</div>
          <div style={{ maxHeight: "22vh", overflowY: "auto" }}>
            {diagnostics.events.slice(-18).map((e, i) => (
              <div key={`${e.at}-${i}`} style={{ whiteSpace: "pre-wrap", opacity: 0.9 }}>
                {new Date(e.at).toISOString().slice(14, 23)} {e.kind} {e.detail}
              </div>
            ))}
          </div>

          <textarea
            ref={textRef}
            readOnly
            value={report}
            aria-hidden="true"
            tabIndex={-1}
            style={{ position: "absolute", opacity: 0, pointerEvents: "none", height: 1, width: 1 }}
          />
        </>
      )}
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  font: "inherit",
  background: "rgba(255,255,255,0.14)",
  color: "inherit",
  border: "1px solid rgba(255,255,255,0.25)",
  borderRadius: 6,
  padding: "3px 7px",
};

export default ViewportDebugOverlay;
