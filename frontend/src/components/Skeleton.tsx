/** A pulsing placeholder block shown in place of real content while a
 * screen's first data fetch is still in flight — replaces the old plain
 * "Loading…" text with something that at least hints at the shape of what's
 * coming, the way most modern apps handle a first load. Purely decorative. */
export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}
