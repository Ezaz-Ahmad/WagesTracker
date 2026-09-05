/**
 * Theme-aware presentation of a persisted spending-category colour.
 * Light mode shows the stored colour unchanged; dark mode lifts it through
 * --chart-category-strength so deep hues remain distinct on OLED surfaces.
 */
export function spendingDisplayColour(colour: string): string {
  return `color-mix(in srgb, ${colour} var(--chart-category-strength), var(--color-text))`;
}
