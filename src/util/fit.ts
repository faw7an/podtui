/**
 * Display-width-aware text fitting.
 *
 * Every line the TUI draws must go through one of these helpers so that no
 * string can ever exceed the width of the rectangle it was given. Ink does not
 * clip: text that is too long *wraps* onto extra rows, which corrupts the
 * layout (verified — see docs/DECISIONS.md "Ink does NOT clip").
 *
 * Widths use `Bun.stringWidth` (built-in, verified to match
 * `string-width@8.3.0`) so wide glyphs, combining marks and ANSI sequences are
 * measured correctly.
 *
 * Escape sequences are zero-width: they are preserved verbatim while slicing,
 * so truncating a coloured string never cuts an escape sequence in half.
 */

/**
 * ANSI/VT escape sequences: CSI (`ESC [ ... final`), OSC (`ESC ] ... BEL` or
 * `ESC ] ... ESC \`), and the two-character Fe escapes.
 */
const ANSI_PATTERN =
  "\\u001B(?:\\[[0-9;?]*[ -/]*[@-~]|\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)|[ -/]*[@-Z\\\\-_])";

const ANSI_RE = new RegExp(ANSI_PATTERN, "g");

const segmenter = new Intl.Segmenter();

/** Split into grapheme clusters so combining marks stay with their base. */
function graphemes(text: string): string[] {
  const out: string[] = [];
  for (const { segment } of segmenter.segment(text)) out.push(segment);
  return out;
}

interface Token {
  text: string;
  /** Display cells; 0 for escape sequences. */
  w: number;
}

/** Tokenize into escape sequences (w=0) and printable graphemes. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pushPlain = (plain: string): void => {
    for (const g of graphemes(plain)) {
      const w = Bun.stringWidth(g);
      if (w > 0 || tokens.length === 0) tokens.push({ text: g, w });
      else tokens[tokens.length - 1] = { text: (tokens[tokens.length - 1]?.text ?? "") + g, w: 0 };
    }
  };

  const re = new RegExp(ANSI_PATTERN, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) pushPlain(text.slice(last, m.index));
    tokens.push({ text: m[0], w: 0 });
    last = m.index + m[0].length;
  }
  if (last < text.length) pushPlain(text.slice(last));
  return tokens;
}

const hasAnsi = (text: string): boolean => new RegExp(ANSI_PATTERN).test(text);

const RESET = "\u001B[0m";

/** Display width in terminal cells. ANSI sequences count as zero. */
export function displayWidth(text: string): number {
  return Bun.stringWidth(text);
}

/** Longest prefix of `text` whose display width is <= `width`, escapes intact. */
export function sliceToWidth(text: string, width: number): string {
  if (width <= 0) return "";
  let out = "";
  let used = 0;
  for (const t of tokenize(text)) {
    if (used + t.w > width) break;
    out += t.text;
    used += t.w;
  }
  return out;
}

/**
 * Keep the cell span `[start, end)` of `text`, escapes intact. Wide glyphs
 * are kept only when fully inside the span — never split, so a straddling
 * glyph is dropped rather than tearing the grid. Like `truncate`, a kept span
 * that contains escapes is terminated with a reset so colour cannot bleed
 * past the slice; a span without escapes gains nothing.
 */
export function sliceCells(text: string, start: number, end?: number): string {
  const stop = end ?? Number.POSITIVE_INFINITY;
  if (stop <= 0 || start >= stop) return "";
  const from = Math.max(0, start);
  let out = "";
  let keptAnsi = false;
  let cursor = 0;
  for (const t of tokenize(text)) {
    if (t.w === 0) {
      if (cursor >= from && cursor < stop) {
        out += t.text;
        if (t.text !== "" && t.text.charCodeAt(0) === 27) keptAnsi = true;
      }
      continue;
    }
    if (cursor >= from && cursor + t.w <= stop) out += t.text;
    cursor += t.w;
  }
  if (keptAnsi && !out.endsWith(RESET)) out += RESET;
  return out;
}

const ELLIPSIS = "…";

/** Truncate to `width` cells, appending `…` when something was cut. */
export function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (Bun.stringWidth(text) <= width) return text;
  const body = sliceToWidth(text, width === 1 ? 0 : width - 1);
  const suffix = ELLIPSIS + (hasAnsi(text) ? RESET : "");
  // The ellipsis is 1 cell, but keep the guard in case a future glyph differs.
  return Bun.stringWidth(body) + 1 <= width ? body + suffix : sliceToWidth(text, width);
}

/** Truncate (if needed) then pad on the right to exactly `width` cells. */
export function padRight(text: string, width: number): string {
  if (width <= 0) return "";
  const t = truncate(text, width);
  const used = Bun.stringWidth(t);
  return used >= width ? t : t + " ".repeat(width - used);
}

/** Truncate (if needed) then pad on the left to exactly `width` cells. */
export function padLeft(text: string, width: number): string {
  if (width <= 0) return "";
  const t = truncate(text, width);
  const used = Bun.stringWidth(t);
  return used >= width ? t : " ".repeat(width - used) + t;
}

/** Truncate (if needed) then centre within exactly `width` cells. */
export function center(text: string, width: number): string {
  if (width <= 0) return "";
  const t = truncate(text, width);
  const used = Bun.stringWidth(t);
  if (used >= width) return t;
  const total = width - used;
  const left = Math.floor(total / 2);
  return " ".repeat(left) + t + " ".repeat(total - left);
}

/**
 * The single entry point components must use: the result is always exactly
 * `width` display cells (or "" when width <= 0).
 */
export function fit(text: string, width: number): string {
  return padRight(text, width);
}

/**
 * Repeat `text` to exactly `width` cells. A trailing partial repetition is
 * truncated, so `fill("toolong", 3) === "too"` rather than blanks.
 */
export function fill(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length === 0) return " ".repeat(width);
  const patternW = Bun.stringWidth(text);
  if (patternW === 0) return " ".repeat(width);

  let out = "";
  let used = 0;
  while (used + patternW <= width) {
    out += text;
    used += patternW;
  }
  const rest = width - used;
  return rest > 0 ? out + sliceToWidth(text, rest) : out;
}

export { ANSI_RE };
