/** Three bouncing dots shown inside a button while it's mid-action (e.g.
 * logging in) — a friendlier, more "alive" stand-in for plain "Loading…"
 * text, sized to sit comfortably inside a button without changing its
 * height. `label` is used as the accessible name since the dots themselves
 * are decorative. */
export function BubbleLoader({ label }: { label: string }) {
  return (
    <span className="bubble-loader" role="status" aria-label={label}>
      <span className="bubble-loader-dot" />
      <span className="bubble-loader-dot" />
      <span className="bubble-loader-dot" />
    </span>
  );
}
