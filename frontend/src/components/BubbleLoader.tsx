/** Compact fallback loader retained for the PDF controls that provide their
 * own width-stable overlay. New form actions use AsyncButton, which also
 * delays the spinner briefly to avoid flashing on instant responses. */
export function BubbleLoader({ label }: { label: string }) {
  return (
    <span className="bubble-loader" role="status" aria-label={label}>
      <span className="compact-loader is-visible" aria-hidden="true" />
    </span>
  );
}
