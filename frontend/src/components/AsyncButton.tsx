import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useDelayedFlag } from "../lib/useDelayedFlag";
import { StableLabel } from "./StableLabel";

type AsyncButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  busy: boolean;
  idleLabel: string;
  busyLabel: string;
  busyAriaLabel?: string;
  complete?: boolean;
  completeLabel?: string;
  icon?: ReactNode;
};

/**
 * One width-stable, accessible treatment for actions that may take time.
 * The busy label appears immediately and the compact spinner joins it only
 * after 120ms, avoiding a one-frame loader flash on a warm response while
 * still disabling duplicate submissions as soon as the action begins.
 */
export const AsyncButton = forwardRef<HTMLButtonElement, AsyncButtonProps>(function AsyncButton({
  busy,
  idleLabel,
  busyLabel,
  busyAriaLabel,
  complete = false,
  completeLabel,
  icon,
  className = "",
  disabled,
  "aria-label": ariaLabel,
  ...buttonProps
}, ref) {
  const showSpinner = useDelayedFlag(busy, 120);
  const settledLabel = complete && completeLabel ? completeLabel : idleLabel;
  const currentLabel = busy ? busyLabel : settledLabel;
  const longestLabel = [idleLabel, busyLabel, completeLabel ?? ""].reduce(
    (longest, candidate) => candidate.length > longest.length ? candidate : longest,
    idleLabel,
  );

  return (
    <button
      ref={ref}
      {...buttonProps}
      className={`${className} btn-stable async-button`.trim()}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-label={busy ? (busyAriaLabel ?? busyLabel) : ariaLabel}
    >
      {busy && (
        <span className="btn-stable-overlay" aria-hidden="true">
          <span className="async-button-busy">
            <span className={`compact-loader${showSpinner ? " is-visible" : ""}`} />
            <span>{busyLabel}</span>
          </span>
        </span>
      )}
      <span className={`async-button-settled${busy ? " btn-stable-hidden" : ""}`} aria-hidden={busy || undefined}>
        {icon}
        <StableLabel current={settledLabel} longest={longestLabel} />
      </span>
      <span className="visually-hidden" aria-live="polite">{busy ? currentLabel : ""}</span>
    </button>
  );
});
