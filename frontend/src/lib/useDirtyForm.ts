import { useCallback, useRef, useState } from "react";

function shallowEqual<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
}

/**
 * Tracks a draft settings object against a "last saved" baseline, so a
 * Settings section can disable its Save button when nothing has changed and
 * reset its dirty state the moment a save genuinely succeeds — never
 * optimistically, and never just because a request was *sent*.
 *
 * `values`/`setValues` behave like a normal `useState` pair for the draft
 * form fields. `dirty` is true whenever `values` differs from the last
 * baseline (the initial values, or whatever was passed to `markSaved` most
 * recently). Call `markSaved(values)` only after the save request has
 * actually resolved successfully.
 */
export function useDirtyForm<T extends object>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const baselineRef = useRef<T>(initial);
  const [, forceRender] = useState(0);

  const dirty = !shallowEqual(values, baselineRef.current);

  const markSaved = useCallback((next: T) => {
    baselineRef.current = next;
    // baselineRef isn't itself reactive state, so a component whose only
    // reason to re-render is "dirty just became false" needs a nudge —
    // callers that also call setValues(next) right after get one for free,
    // but markSaved needs to be safe to call on its own too.
    forceRender((n) => n + 1);
  }, []);

  return { values, setValues, dirty, markSaved };
}
