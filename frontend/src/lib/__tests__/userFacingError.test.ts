import { describe, expect, it } from "vitest";
import { toUserFacingError } from "../userFacingError";

describe("toUserFacingError", () => {
  it("replaces internal request and sign-in terms", () => {
    expect(toUserFacingError("Invalid or expired token", 401)).toBe("Your sign-in has expired. Please log in again.");
    expect(toUserFacingError("Request failed (500)", 500)).toBe("Something went wrong. Please try again.");
    expect(toUserFacingError("weekStart must be YYYY-MM-DD", 400)).toBe("Choose a valid date and try again.");
  });

  it("keeps helpful validation messages", () => {
    expect(toUserFacingError("Amount must be greater than zero.", 400)).toBe("Amount must be greater than zero.");
  });
});
