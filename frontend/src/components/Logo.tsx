/** The app's mark — a coin with a dollar sign, since this is a wage/earnings
 * tracker. Used next to the "Wage Tracker" wordmark in nav/sidebar/auth. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: "block", flex: "none" }}>
      <circle cx="16" cy="16" r="16" fill="var(--color-accent)" />
      <circle cx="16" cy="16" r="12.5" fill="none" stroke="var(--color-accent-800)" strokeWidth="1.1" opacity="0.55" />
      <text
        x="16"
        y="21.5"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="800"
        fontSize="18"
        fill="var(--color-on-accent)"
        textAnchor="middle"
      >
        $
      </text>
    </svg>
  );
}
