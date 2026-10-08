import { stripAnsi } from "./logLevel.ts";

/**
 * Make a raw log line safe to place in a fixed-width frame.
 *
 * Decision (FR-5, DECISIONS phase-3/P3-T3): raw ANSI from the container is
 * STRIPPED, not passed through. Passed-through escapes can move the cursor,
 * clear lines or leave colour open across our borders; a stripped line can
 * only ever occupy its own cells, and podtui re-colours it by level.
 *
 * Also: tabs expand to 8-column stops, and any other control character
 * (including a stray `\r` from progress bars, or an ESC left over from a
 * malformed sequence) is dropped, because each would move the cursor.
 */
export function sanitizeLogText(raw: string): string {
  const text = stripAnsi(raw);
  let out = "";
  let col = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\t") {
      const pad = 8 - (col % 8);
      out += " ".repeat(pad);
      col += pad;
    } else if (code < 0x20 || (code >= 0x7f && code < 0xa0)) {
      continue;
    } else {
      out += ch;
      // Column only matters for tab stops; wide glyphs are rare enough in
      // logs that counting code points is an acceptable approximation here.
      col += 1;
    }
  }
  return out;
}
