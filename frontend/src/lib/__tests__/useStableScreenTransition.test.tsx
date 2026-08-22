// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useStableScreenTransition } from "../useStableScreenTransition";
import type { Screen } from "../types";

function Probe({ selected, unrelated }: { selected: Screen; unrelated: number }) {
  const className = useStableScreenTransition(selected);
  return <div data-testid="transition" className={className}>{unrelated}</div>;
}

afterEach(cleanup);

describe("stable screen transitions", () => {
  it("changes direction only for navigation and never for unrelated renders", () => {
    const { rerender } = render(<Probe selected="home" unrelated={0} />);
    expect(screen.getByTestId("transition").className).toBe("screen-transition");
    rerender(<Probe selected="spending" unrelated={0} />);
    expect(screen.getByTestId("transition").className).toBe("screen-transition dir-fwd");
    rerender(<Probe selected="spending" unrelated={1} />);
    expect(screen.getByTestId("transition").className).toBe("screen-transition dir-fwd");
    rerender(<Probe selected="home" unrelated={1} />);
    expect(screen.getByTestId("transition").className).toBe("screen-transition dir-back");
    rerender(<Probe selected="home" unrelated={2} />);
    expect(screen.getByTestId("transition").className).toBe("screen-transition dir-back");
  });
});
