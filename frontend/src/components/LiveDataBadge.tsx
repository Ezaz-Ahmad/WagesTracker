export function LiveDataBadge({ active, label = "Live" }: { active: boolean; label?: string }) {
  if (!active) return null;
  return (
    <span className="live-data-badge is-active" aria-label={`${label}. Values update while the shift is active.`}>
      <span className="live-data-dot" aria-hidden="true" />
      <span aria-hidden="true">{label}</span>
    </span>
  );
}
