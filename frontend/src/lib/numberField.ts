export interface NumberFieldResult {
  /** The numeric value to send to the backend once `valid` is true. */
  value: number;
  valid: boolean;
  /** `null` while valid — shown as an inline field hint otherwise. */
  error: string | null;
}

/**
 * Parses a raw text input into a validated number, for numeric Settings
 * fields (hourly rate, weekly goals) that keep the *raw string* in draft
 * state rather than a pre-coerced number. This is the piece that stops
 * "not a number" from silently becoming 0: an empty field is a deliberate,
 * valid zero (clearing a rate/goal is a normal thing to do), but anything
 * non-empty that isn't a valid number in range is reported as invalid and
 * must block saving — never coerced.
 */
export function parseNumberField(raw: string, opts: { min?: number; max?: number } = {}): NumberFieldResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: 0, valid: true, error: null };

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { value: NaN, valid: false, error: "Enter a valid number" };
  }
  if (opts.min !== undefined && parsed < opts.min) {
    return { value: parsed, valid: false, error: `Must be ${opts.min} or more` };
  }
  if (opts.max !== undefined && parsed > opts.max) {
    return { value: parsed, valid: false, error: `Must be ${opts.max} or less` };
  }
  return { value: parsed, valid: true, error: null };
}
