/**
 * The textual equivalent of a chart: the same numbers, as a real table,
 * visually hidden but fully present in the accessibility tree.
 *
 * Every chart in this app was previously inaccessible in the same way — an
 * `<svg>` or a row of `<div>`s with no name and no role, whose values
 * existed only as text positioned by coordinate. A screen reader either
 * announced nothing or read a bare sequence of numbers with no indication
 * of what they measured or which period each belonged to.
 *
 * Pairing `role="img"` + a one-line `aria-label` on the graphic with this
 * table is the standard treatment, and it's better than trying to make the
 * SVG itself navigable: the summary gives the shape at a glance, and anyone
 * who wants the actual figures gets them in a structure built for tabular
 * data, with real header cells and a caption.
 *
 * `.visually-hidden` (clip-based) rather than `display: none` — the latter
 * would remove the whole thing from the accessibility tree, which is
 * exactly the bug this fixes.
 */
export function ChartDataTable({
  caption,
  valueHeading,
  rows,
  labelHeading = "Period",
}: {
  caption: string;
  valueHeading: string;
  labelHeading?: string;
  rows: readonly { label: string; value: string }[];
}) {
  return (
    <table className="visually-hidden">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{labelHeading}</th>
          <th scope="col">{valueHeading}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <th scope="row">{r.label}</th>
            <td>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
