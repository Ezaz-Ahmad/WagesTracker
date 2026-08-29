export function LiveDataBadge({ active, label = "Live" }: { active: boolean; label?: string }) {
  return (
    <span className={`live-data-badge${active ? " is-active" : ""}`} aria-hidden={!active}>
      <span className="live-data-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
