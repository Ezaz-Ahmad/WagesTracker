/**
 * Renders `current` inside a box sized to fit `longest` — so a button whose
 * label swaps between an idle and an in-progress form of itself ("Save
 * changes" / "Saving…", "Log out" / "Logging out…") never changes width or
 * height as the text changes, which would otherwise nudge sibling content
 * (or, worse, a whole row of controls) sideways every time a save/loading
 * state flips.
 *
 * Both strings are rendered on top of each other in the same CSS grid cell
 * (see `.stable-label` in tokens.css): the invisible one still occupies
 * layout space (visibility: hidden, not display: none), so the box is
 * always exactly as wide as whichever of the two is longer, regardless of
 * which one is currently shown or how the active font renders either
 * string. If `current` and `longest` are the same string, this is a no-op
 * wrapper with no visible difference from rendering the text directly.
 */
export function StableLabel({ current, longest }: { current: string; longest: string }) {
  return (
    <span className="stable-label">
      <span className="stable-label-ghost" aria-hidden="true">
        {longest}
      </span>
      <span className="stable-label-current">{current}</span>
    </span>
  );
}
