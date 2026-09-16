import { describe, expect, it } from "vitest";
import { validateEmailAddress } from "../emailPolicy";

describe("validateEmailAddress", () => {
  it("normalizes casing and surrounding whitespace without changing the typed field", () => {
    expect(validateEmailAddress("  Alex+Work@Example.COM ")).toEqual({
      valid: true,
      normalized: "alex+work@example.com",
    });
  });

  it.each([
    "not-an-email",
    "two@@example.com",
    ".alex@example.com",
    "alex..work@example.com",
    "alex@example",
    "alex@-example.com",
    "alex@example.c",
  ])("rejects invalid shape: %s", (email) => {
    expect(validateEmailAddress(email).valid).toBe(false);
  });

  it("suggests a likely provider typo but leaves the original normalized value intact", () => {
    expect(validateEmailAddress("alex@gmial.com")).toEqual({
      valid: true,
      normalized: "alex@gmial.com",
      suggestion: "alex@gmail.com",
    });
  });

  it("catches hmail.com as a likely gmail.com typo", () => {
    expect(validateEmailAddress("alex@hmail.com")).toEqual({
      valid: true,
      normalized: "alex@hmail.com",
      suggestion: "alex@gmail.com",
    });
  });

  it.each([
    "gmmail.com",
    "gmali.com",
    "gmail.cmo",
    "gmail.comm",
  ])("catches a one-edit Gmail typo: %s", (domain) => {
    expect(validateEmailAddress(`akibali@${domain}`)).toEqual({
      valid: true,
      normalized: `akibali@${domain}`,
      suggestion: "akibali@gmail.com",
    });
  });

  it.each(["mail.com", "email.com", "ymail.com", "company.example"])(
    "does not flag a legitimate non-Gmail domain: %s",
    (domain) => {
      expect(validateEmailAddress(`alex@${domain}`)).toEqual({
        valid: true,
        normalized: `alex@${domain}`,
      });
    },
  );
});
