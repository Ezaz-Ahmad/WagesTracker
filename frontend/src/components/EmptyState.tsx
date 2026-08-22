import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state${compact ? " is-compact" : ""}`}>
      <span className="empty-state-icon" aria-hidden="true">{icon}</span>
      <strong className="empty-state-title">{title}</strong>
      <p className="empty-state-description">{description}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
