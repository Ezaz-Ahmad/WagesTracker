// The weekly PDF filename rule.
//
// One function serves both the Report screen (current week) and History (any
// completed week), so these cases pin the shared contract rather than either
// caller. The hostile inputs are not hypothetical: the display name is
// user-editable free text in Settings, and it ends up in a filename and
// potentially a Content-Disposition header.
import { describe, expect, it } from "vitest";
import { sanitizeNameForFilename, weeklyPdfFilename } from "../pdfFilename";

describe("weeklyPdfFilename", () => {
  it("uses the documented shape", () => {
    expect(weeklyPdfFilename("Ezaz Ahmad", "2026-08-03", "2026-08-09")).toBe("Ezaz Ahmad-2026-08-03-to-2026-08-09.pdf");
  });

  it("keeps readable spaces and capitalisation in an ordinary name", () => {
    // The previous scheme lower-cased and hyphenated the name, producing
    // "sam-lee-wages-report-...". Nothing required that, and it made the
    // file look machine-generated rather than like the user's own document.
    expect(weeklyPdfFilename("Sam Lee", "2026-01-05", "2026-01-11")).toBe("Sam Lee-2026-01-05-to-2026-01-11.pdf");
  });

  it("uses the dates it is given rather than deriving a week itself", () => {
    // A Sunday-start week. This function must not know or guess where a week
    // begins — the caller has already resolved that from the user's setting.
    expect(weeklyPdfFilename("Sam Lee", "2026-01-04", "2026-01-10")).toBe("Sam Lee-2026-01-04-to-2026-01-10.pdf");
  });

  it("sorts chronologically in a file manager", () => {
    // The real reason for ISO dates over the old prose range
    // ("aug-3-aug-9-2026"), which sorts alphabetically by month name.
    const names = [
      weeklyPdfFilename("Sam", "2026-08-03", "2026-08-09"),
      weeklyPdfFilename("Sam", "2026-01-05", "2026-01-11"),
      weeklyPdfFilename("Sam", "2026-12-07", "2026-12-13"),
    ];
    expect([...names].sort()).toEqual([
      "Sam-2026-01-05-to-2026-01-11.pdf",
      "Sam-2026-08-03-to-2026-08-09.pdf",
      "Sam-2026-12-07-to-2026-12-13.pdf",
    ]);
  });
});

describe("name sanitising", () => {
  it("keeps Unicode letters and accents intact", () => {
    // Mangling these to ASCII would rename the user, not protect anything —
    // every filesystem in play handles them fine.
    expect(sanitizeNameForFilename("Zoë Müller")).toBe("Zoë Müller");
    expect(sanitizeNameForFilename("محمد علي")).toBe("محمد علي");
    expect(sanitizeNameForFilename("李小龍")).toBe("李小龍");
  });

  it("replaces every character no filesystem accepts", () => {
    expect(sanitizeNameForFilename('a/b\\c:d*e?f"g<h>i|j')).toBe("a b c d e f g h i j");
  });

  it("collapses the whitespace a replacement leaves behind", () => {
    // Naively replacing each reserved char with a space turns "A//B" into
    // "A  B" — two spaces, which reads as a mistake in a filename.
    expect(sanitizeNameForFilename("A//B")).toBe("A B");
    expect(sanitizeNameForFilename("A \t\n B")).toBe("A B");
  });

  it("strips control characters, including the ones that would split a header", () => {
    // Written with explicit escapes rather than literal bytes: raw control
    // characters in a source file make it unreadable to tooling (git and
    // grep both classify it as binary) and invisible in review.
    //
    // CRLF matters beyond filename validity — a newline reaching a
    // Content-Disposition header is a response-splitting vector, so it is
    // removed at the source rather than left to whichever consumer happens
    // to handle it.
    expect(sanitizeNameForFilename("Sam\r\nX-Injected: 1")).toBe("SamX-Injected 1");
    expect(sanitizeNameForFilename("Sam\u0000Lee")).toBe("SamLee");
    expect(sanitizeNameForFilename("Sam\u0007Lee")).toBe("SamLee");
    expect(sanitizeNameForFilename("Sam\u001bLee")).toBe("SamLee");
    // C1 range too, which a naive /[\x00-\x1f]/ misses.
    expect(sanitizeNameForFilename("Sam\u0085Lee")).toBe("SamLee");
  });

  it("defuses path traversal in every form it can arrive in", () => {
    expect(sanitizeNameForFilename("../../etc/passwd")).not.toContain("..");
    expect(sanitizeNameForFilename("..\\..\\Windows")).not.toContain("..");
    expect(sanitizeNameForFilename("../../etc/passwd")).not.toContain("/");
    // And the result is still a single path segment.
    const name = weeklyPdfFilename("../../etc/passwd", "2026-08-03", "2026-08-09");
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
    expect(name).not.toContain("..");
  });

  it("strips leading and trailing dots and spaces", () => {
    // A leading dot makes a hidden file on Unix; Windows silently drops
    // trailing dots and spaces, which would rename the file after the fact.
    expect(sanitizeNameForFilename("  Sam Lee  ")).toBe("Sam Lee");
    expect(sanitizeNameForFilename(".Sam")).toBe("Sam");
    expect(sanitizeNameForFilename("Sam.")).toBe("Sam");
    expect(sanitizeNameForFilename("...")).toBe("User");
  });

  it("falls back rather than producing a reserved Windows device name", () => {
    // CON.pdf is not a file on Windows — it addresses the console.
    expect(sanitizeNameForFilename("CON")).toBe("User");
    expect(sanitizeNameForFilename("nul")).toBe("User");
    expect(sanitizeNameForFilename("COM1")).toBe("User");
    // But a name that merely contains one is fine.
    expect(sanitizeNameForFilename("Conrad")).toBe("Conrad");
  });

  it("falls back to User when the name is empty or vanishes entirely", () => {
    expect(weeklyPdfFilename("", "2026-08-03", "2026-08-09")).toBe("User-2026-08-03-to-2026-08-09.pdf");
    expect(weeklyPdfFilename("   ", "2026-08-03", "2026-08-09")).toBe("User-2026-08-03-to-2026-08-09.pdf");
    expect(weeklyPdfFilename("///", "2026-08-03", "2026-08-09")).toBe("User-2026-08-03-to-2026-08-09.pdf");
    // Never a user id — that would put an internal identifier on a document
    // the user hands to an employer.
    expect(weeklyPdfFilename("", "2026-08-03", "2026-08-09")).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it("survives a name that is null or undefined at runtime", () => {
    // The type says string, but this reads from a server payload.
    expect(sanitizeNameForFilename(undefined as unknown as string)).toBe("User");
    expect(sanitizeNameForFilename(null as unknown as string)).toBe("User");
  });

  it("caps an absurdly long name without splitting a surrogate pair", () => {
    const long = "Sam ".repeat(200);
    const out = sanitizeNameForFilename(long);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(150);

    // Emoji are surrogate pairs; cutting by string index rather than by code
    // point would leave a lone surrogate and an unpaired replacement char.
    const emoji = "😀".repeat(100);
    const cut = sanitizeNameForFilename(emoji);
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(150);
    // The `u` flag is load-bearing: without it this range matches the two
    // halves of every well-formed pair as well, so the assertion would fail
    // on correct output. With it, only an unpaired surrogate matches.
    expect(cut).not.toMatch(/[\uD800-\uDFFF]/u);
    expect([...cut].every((ch) => ch === "😀")).toBe(true);
  });

  it("produces a filename with exactly one extension", () => {
    // A name ending ".pdf" must not yield "Report.pdf-...-.pdf" in a way
    // that confuses the extension, nor a double dot.
    const name = weeklyPdfFilename("Weekly Report.pdf", "2026-08-03", "2026-08-09");
    expect(name.endsWith(".pdf")).toBe(true);
    expect(name.match(/\.pdf/g)).toHaveLength(2); // one in the name, one as the extension
    expect(name).not.toContain("..");
  });
});
