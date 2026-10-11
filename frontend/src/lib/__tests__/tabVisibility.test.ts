import { describe, expect, it } from "vitest";
import { shiftAccessWarning } from "../tabVisibility";

describe("tab-hiding impact", () => {
  it("warns when hiding a tab removes the remaining in-app shift controls", () => {
    expect(shiftAccessWarning("home", ["entry"], [])).toContain("restore Home or Entry");
    expect(shiftAccessWarning("entry", ["home"], [])).toContain("Any active shift keeps running");
    expect(shiftAccessWarning("entry", [], ["today-shift"])).toContain("show Today's shift on Home");
  });
  it("does not claim shift controls are lost when Home or Entry still provides them", () => {
    expect(shiftAccessWarning("home", [], [])).toBeNull();
    expect(shiftAccessWarning("entry", [], [])).toBeNull();
    expect(shiftAccessWarning("spending", ["entry", "home"], [])).toBeNull();
  });
});
