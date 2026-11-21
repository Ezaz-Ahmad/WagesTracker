/**
 * The one place a weekly PDF's filename is built.
 *
 *     {display name}-{week start}-to-{week end}.pdf
 *     Ezaz Ahmad-2026-08-03-to-2026-08-09.pdf
 *
 * Both the Report screen (current week) and History (any completed week) go
 * through this. Keeping it in one function is the point: a second copy would
 * drift, and the two would eventually disagree about what a week is called —
 * which is exactly the kind of difference nobody notices until a folder of
 * downloads won't sort.
 *
 * The name comes from the authenticated profile the app already holds. It is
 * never taken from a query parameter, a user id, or anything else the caller
 * could supply, so there is no path by which one user's download can be made
 * to carry another's name.
 *
 * The previous scheme was `{slugged-name}-wages-report-{prose date range}`,
 * e.g. `sam-lee-wages-report-aug-3-aug-9-2026.pdf`. It lower-cased and
 * hyphenated the name (losing capitalisation and any non-ASCII character
 * entirely) and used a display date range that neither sorts nor parses.
 * ISO dates sort correctly in any file manager, which is the property that
 * actually matters once you have a year of these in one folder.
 */

/** Characters no mainstream filesystem accepts, plus the two path separators.
 * Windows is the strict one here and the union is what we honour everywhere,
 * so the same file name works wherever it lands. */
const RESERVED_CHARS = /[/\\:*?"<>|]/g;

/** C0 and C1 control ranges, including CR and LF. Beyond being invalid in a
 * filename, a newline reaching a `Content-Disposition` header would be a
 * response-splitting vector, so it is stripped at the source rather than
 * being left to whichever consumer happens to handle it. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/** Reserved device names on Windows. `CON.pdf` is not a file you can create
 * there — it addresses the console. Rare, but the fallback costs nothing and
 * this app's author is on Windows. */
const WINDOWS_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Used when the profile name is empty, or sanitises down to nothing (a name
 * consisting solely of reserved characters, say). Never a user id — that
 * would put an internal identifier on a file the user shares with an
 * employer. */
const FALLBACK_NAME = "User";

/** Keeps the whole filename comfortably inside the ~255-byte limit common to
 * ext4, APFS and NTFS, after the 30 characters the date range and extension
 * add. Multi-byte characters mean a generous character budget can still
 * exceed a byte limit, so the cap is applied to the encoded length. */
const MAX_NAME_BYTES = 150;

function truncateToBytes(value: string, maxBytes: number): string {
  if (new TextEncoder().encode(value).length <= maxBytes) return value;
  // Cut by code point, not by index, so a surrogate pair is never split in
  // half and left as a lone surrogate.
  let out = "";
  for (const ch of value) {
    if (new TextEncoder().encode(out + ch).length > maxBytes) break;
    out += ch;
  }
  return out.trimEnd();
}

/**
 * Makes an arbitrary display name safe to use as part of a filename, while
 * keeping it readable. Spaces and non-ASCII letters survive — "Ezaz Ahmad"
 * and "Zoë Müller" are perfectly good filenames and mangling them into
 * `ezaz-ahmad` serves nobody.
 */
export function sanitizeNameForFilename(rawName: string): string {
  let name = (rawName ?? "")
    .replace(CONTROL_CHARS, "")
    .replace(RESERVED_CHARS, " ")
    // Collapse whitespace (including any introduced by the line above) so a
    // replaced character doesn't leave a double space behind.
    .replace(/\s+/g, " ")
    .trim();

  // Path traversal: `..` cannot survive in any form. The separators are
  // already gone above, so this is belt-and-braces against a name like
  // "..\\..\\etc" whose separators became spaces, leaving ".. .. etc".
  name = name.replace(/\.{2,}/g, ".");

  // Windows silently strips trailing dots and spaces, which would turn
  // "Sam." into "Sam" *after* the fact — leading ones make a hidden file on
  // Unix. Removing both here means the name on disk is the name we chose.
  name = name.replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");

  name = truncateToBytes(name, MAX_NAME_BYTES);

  if (!name || WINDOWS_DEVICE_NAMES.test(name)) return FALLBACK_NAME;
  return name;
}

/**
 * `{name}-{start}-to-{end}.pdf`.
 *
 * `weekStartISO` and `weekEndISO` must be the real first and last dates of
 * the week being downloaded, already resolved against the user's week-start
 * preference — this function does not know or guess where a week begins.
 */
export function weeklyPdfFilename(displayName: string, weekStartISO: string, weekEndISO: string, jobName?:string): string {
  const scope=jobName?`-${truncateToBytes(sanitizeNameForFilename(jobName),60)}`:"";
  return `${sanitizeNameForFilename(displayName)}${scope}-${weekStartISO}-to-${weekEndISO}.pdf`;
}
