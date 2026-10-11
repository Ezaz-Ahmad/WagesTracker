/** The time-to-pay mark uses the approved graphite and obsidian artwork.
 * CSS follows the resolved app theme, including a saved appearance override. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <span className="app-logo" aria-hidden="true" style={{ width: size, height: size }}>
      <img className="app-logo-default" src="/logo-graphite.png" width={size} height={size} alt="" />
      <img className="app-logo-dark" src="/logo-dark.png" width={size} height={size} alt="" />
    </span>
  );
}
