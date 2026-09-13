import { useEffect, useLayoutEffect, useState } from "react";
import { BubbleLoader } from "../components/BubbleLoader";
import { PublicPageShell } from "../components/PublicPageShell";
import { StatusBanner } from "../components/StatusBanner";
import { verifyEmail, type VerifyEmailResult } from "../lib/api";
import { clearDeepLink } from "../platform/deepLinks";

type Stage = "checking" | "invalid" | "done";

function tokenFromLocation(): string {
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") ?? "";
}

export function VerifyEmailPage({ token: providedToken }: { token?: string } = {}) {
  const [token] = useState(() => providedToken ?? tokenFromLocation());
  const [stage, setStage] = useState<Stage>("checking");
  const [result, setResult] = useState<VerifyEmailResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (window.location.hash) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setMessage("This verification link is incomplete. Request a new one from Wage Tracker.");
      setStage("invalid");
      return;
    }
    void (async () => {
      try {
        const next = await verifyEmail(token);
        if (cancelled) return;
        setResult(next);
        setStage("done");
      } catch (error) {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : "This email verification link is no longer valid.");
        setStage("invalid");
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const returnToApp = () => {
    if (providedToken) clearDeepLink();
  };

  return (
    <PublicPageShell
      standalone
      eyebrow="Account security"
      title="Verify your email"
      summary="Email ownership is confirmed with a secure, single-use link. Wage Tracker never changes your password during this process."
    >
      {stage === "checking" && <p className="public-page-note" role="status"><BubbleLoader label="Verifying your email" /></p>}
      {stage === "invalid" && (
        <>
          <StatusBanner tone="danger">{message ?? "This verification link is no longer valid."}</StatusBanner>
          <p>Verification links work once and expire after 24 hours. Return to Wage Tracker to request a fresh link.</p>
          <p><a className="btn btn-primary" href="/" onClick={returnToApp}>Back to Wage Tracker</a></p>
        </>
      )}
      {stage === "done" && result && (
        <>
          <StatusBanner tone="success">{result.message}</StatusBanner>
          <p><strong>{result.email}</strong> is now {result.purpose === "signup" ? "verified for your account" : "your login email"}.</p>
          <p>Your password, shifts, reports, settings, and active sessions were not changed.</p>
          <p><a className="btn btn-primary" href="/" onClick={returnToApp}>{result.purpose === "signup" ? "Go to log in" : "Return to Wage Tracker"}</a></p>
        </>
      )}
    </PublicPageShell>
  );
}
