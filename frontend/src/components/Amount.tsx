import { useApp } from "../context/AppContext";

/**
 * Wraps a dollar figure so the app-wide earnings-privacy toggle (the eye
 * button in the top nav) can blur it. Only ever wrap *display* text with
 * this — never the content of an input someone is actively editing (the
 * fuel-cost/other-earnings amount fields), since blurring something you're
 * trying to type into would make it unusable rather than private.
 */
export function Amount({ children, className }: { children: React.ReactNode; className?: string }) {
  const { earningsHidden } = useApp();
  return (
    <span
      className={`amount-mask${earningsHidden ? " is-hidden" : ""}${className ? ` ${className}` : ""}`}
      aria-label={earningsHidden ? "Amount hidden" : undefined}
    >
      {children}
    </span>
  );
}
