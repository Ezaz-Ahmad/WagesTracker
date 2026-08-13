// @vitest-environment jsdom
//
// Modal overlays must escape the app's transformed ancestor, and must lock
// the element that actually scrolls.
//
// `.swipe-track` (App.tsx) always carries a `transform` — it is what the
// tab-swipe and pull-to-refresh gestures translate. A transformed element
// becomes the containing block for its `position: fixed` descendants, so
// every overlay rendered inside a screen was fixed to the *track* rather
// than to the viewport. Measured on a 390x844 phone with the sessions sheet
// open, its `inset: 0` backdrop resolved to a 1218px box starting at
// y = -477, inset 16px each side: the app header was never covered (Log out
// and the earnings-privacy toggle stayed clickable behind an
// `aria-modal="true"` dialog), there were undimmed strips down both edges,
// and the sheet travelled with the content when the pane behind it scrolled.
//
// jsdom cannot reproduce that geometry — it does no layout, so a `transform`
// on an ancestor has no observable effect here. What it *can* pin is the two
// structural facts the fix rests on, which are also the two a later refactor
// would quietly undo: the overlay renders outside the transformed subtree,
// and the lock is applied to the real scroll container rather than to
// `<body>` on faith. The geometry itself is checked in the headless
// breakpoint run against a real engine.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Overlay } from "../Overlay";

afterEach(cleanup);

function Shell({ children, withMain = true }: { children?: React.ReactNode; withMain?: boolean }) {
  return (
    <div className="app-shell">
      {withMain ? (
        <main className="app-main">
          <div className="swipe-track" style={{ transform: "translate(0px, 0px)" }}>
            {children}
          </div>
        </main>
      ) : (
        <div className="swipe-track" style={{ transform: "translate(0px, 0px)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

describe("Overlay portalling", () => {
  it("renders outside the transformed ancestor it was declared inside", () => {
    const { container } = render(
      <Shell>
        <Overlay>
          <div data-testid="sheet">sheet</div>
        </Overlay>
      </Shell>
    );

    const sheet = screen.getByTestId("sheet");
    // Present in the document...
    expect(sheet).toBeTruthy();
    // ...but not underneath the transformed track, which is the whole point.
    expect(container.querySelector(".swipe-track")!.contains(sheet)).toBe(false);
    expect(container.contains(sheet)).toBe(false);
    expect(document.body.contains(sheet)).toBe(true);
  });
});

describe("Overlay scroll locking", () => {
  it("locks .app-main, the element that actually scrolls", () => {
    // The usual `document.body.style.overflow = "hidden"` recipe does
    // nothing in the authenticated shell: <body> is not the scroller there.
    const { unmount } = render(
      <Shell>
        <Overlay>
          <div>sheet</div>
        </Overlay>
      </Shell>
    );

    const main = document.querySelector(".app-main") as HTMLElement;
    expect(main.style.overflow).toBe("hidden");
    unmount();
  });

  it("restores the previous value rather than blanking it", () => {
    // Settings and the shell both set overflow of their own at times;
    // resetting to "" on close would clear a lock this component never set.
    const { unmount } = render(
      <Shell>
        <div />
      </Shell>
    );
    const main = document.querySelector(".app-main") as HTMLElement;
    main.style.overflow = "scroll";

    const overlay = render(
      <Overlay>
        <div>sheet</div>
      </Overlay>
    );
    expect(main.style.overflow).toBe("hidden");

    overlay.unmount();
    expect(main.style.overflow).toBe("scroll");
    unmount();
  });

  it("falls back to <body> where there is no .app-main", () => {
    // The auth screen and the admin tree scroll the document itself.
    const previous = document.body.style.overflow;
    const { unmount } = render(
      <Shell withMain={false}>
        <Overlay>
          <div>sheet</div>
        </Overlay>
      </Shell>
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe(previous);
  });

  it("leaves nothing locked once unmounted", () => {
    const { unmount } = render(
      <Shell>
        <Overlay>
          <div data-testid="sheet">sheet</div>
        </Overlay>
      </Shell>
    );
    const main = document.querySelector(".app-main") as HTMLElement;
    unmount();
    expect(main.style.overflow).toBe("");
    expect(document.body.style.overflow).toBe("");
    expect(screen.queryByTestId("sheet")).toBeNull();
  });
});
