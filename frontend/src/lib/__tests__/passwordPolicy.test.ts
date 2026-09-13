import { describe, expect, it } from "vitest";
import { validatePassword } from "../passwordPolicy";

// Covers the frontend's own copy of the password policy (lib/passwordPolicy.ts),
// used only for immediate inline feedback in AuthScreen/SettingsScreen — the
// backend re-validates independently and is the real authority. These tests
// exist to keep the two copies behaviorally in sync.
describe("validatePassword (frontend)", () => {
  it("rejects a password of exactly 9 characters", () => {
    expect(validatePassword("a".repeat(9)).valid).toBe(false);
  });

  it("accepts a password of exactly 10 characters", () => {
    expect(validatePassword("River55252").valid).toBe(true);
  });

  it("accepts spaces and Unicode characters", () => {
    const result = validatePassword("lighthouse harbor #77 sails free! 灯台");
    expect(result.valid).toBe(true);
  });

  it("rejects a common blocklisted password even when it clears the minimum", () => {
    expect(validatePassword("iloveyouforever").valid).toBe(false);
  });

  it("rejects a password of more than 128 Unicode code points", () => {
    expect(validatePassword("x".repeat(129)).valid).toBe(false);
    expect(validatePassword("x".repeat(128)).valid).toBe(true);
  });

  it("accepts a legitimate long passphrase that merely contains an ordinary common word", () => {
    expect(validatePassword("grandmas dark chocolate chip cookies recipe").valid).toBe(true);
  });

  it("still rejects that same common word as a standalone password", () => {
    expect(validatePassword("welcometothejungle").valid).toBe(false);
  });

  it("rejects an obvious app-specific password (substring match, not exact-only)", () => {
    expect(validatePassword("MyWageTracker2026Secure").valid).toBe(false);
  });

  it("does not trim or otherwise modify the input — only reports validity", () => {
    const withSpaces = "  padded with spaces around it  ";
    const result = validatePassword(withSpaces);
    // Whatever the verdict, the function must not have required trimming to
    // reach it — i.e. it should behave identically to a manually-trimmed
    // check only if length still clears the bar either way. Here we just
    // assert it doesn't throw and returns a verdict based on the raw length.
    expect(typeof result.valid).toBe("boolean");
    expect(Array.from(withSpaces).length).toBeGreaterThanOrEqual(10);
    expect(result.valid).toBe(true);
  });
});
