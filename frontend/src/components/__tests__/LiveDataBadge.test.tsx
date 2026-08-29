// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiveDataBadge } from "../LiveDataBadge";

describe("LiveDataBadge", () => {
  it("is absent for historical or otherwise static data", () => {
    const { container } = render(<LiveDataBadge active={false} />);
    expect(container.childElementCount).toBe(0);
  });

  it("exposes one concise accessible live-status description when active", () => {
    render(<LiveDataBadge active label="Live" />);
    expect(screen.getByLabelText("Live. Values update while the shift is active.")).toBeTruthy();
    expect(screen.getAllByText("Live")).toHaveLength(1);
  });
});
