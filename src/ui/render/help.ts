import { fit } from "../../util/fit.ts";
import type { Theme } from "../../theme/theme.ts";
import { bold, dim, fg, paint, RESET } from "./palette.ts";
import { HELP_CLOSE_HINT, HELP_TITLE, helpLines } from "../view/help.ts";

/**
 * The `?` help overlay (ROADMAP P2-T8), drawn over the whole frame.
 *
 * Same discipline as the rest of the renderer: a pre-composed buffer of exactly
 * `rows` lines of exactly `cols` cells, so opening the overlay can never
 * corrupt the layout beneath it or overflow the terminal.
 */

const TL = "╭";
const TR = "╮";
const BL = "└";
const BR = "┘";
const H = "─";
const V = "│";

export function renderHelp(
  size: { cols: number; rows: number },
  theme: Theme,
  color = true,
): string[] {
  const on = color;
  const { cols, rows } = size;
  const out: string[] = [];
  if (cols <= 0 || rows <= 0) return out;

  // Too small for a box: a single centred line, still width-bounded.
  if (cols < 20 || rows < 5) {
    const msg = fit(`${HELP_TITLE} — ${HELP_CLOSE_HINT}`, cols);
    for (let y = 0; y < rows; y++) {
      out.push(y === Math.floor(rows / 2) ? msg : " ".repeat(cols));
    }
    return out;
  }

  // Box inset by one cell so the frame behind is still hinted at the edges.
  const boxW = cols - 2;
  const boxY = 1;
  const boxH = Math.min(rows - 2, helpLines().length + 4);

  const bc = on ? fg(theme.border) : "";
  const innerW = boxW - 2;

  // `fit` truncates AND pads to exactly `cols` cells; `padEnd` alone would let
  // a long line overflow.
  const push = (line: string): void => {
    out.push(fit(line, cols));
  };

  // Above / below the box: blank filler.
  for (let y = 0; y < boxY; y++) push("");

  const title = fit(HELP_TITLE, innerW);
  const titleFill = Math.max(0, innerW - title.length - 1);
  push(`${bc}${TL}${H}${on ? bold() : ""}${on ? fg(theme.accent) : ""}${title}${on ? RESET : ""}${bc}${H.repeat(titleFill)}${TR}${on ? RESET : ""}`);

  // Content rows between the title border and the bottom border. The close
  // hint lives IN the bottom border, so it can never be windowed away.
  const lines = helpLines();
  const columns = layoutColumns(lines, Math.max(0, boxH - 2) - 1, innerW);
  // Spacer row + the tallest column, never more than the box allows.
  const contentRoom = Math.min(Math.max(0, boxH - 2), 1 + Math.max(...columns.map((c) => c.length)));
  const colW = Math.floor(innerW / columns.length);

  const paintLine = (line: string): string =>
    line.startsWith("#") ? paint(line, [on ? fg(theme.accent) : "", on ? bold() : ""]) : line;

  // Anything that still does not fit is announced, never silently dropped.
  const lastCol = columns[columns.length - 1];
  const overflow = Math.max(0, (lastCol?.length ?? 0) - (contentRoom - 1));
  if (overflow > 0 && contentRoom > 1) {
    const col = lastCol;
    if (col) {
      const keep = contentRoom - 2;
      const hidden = col.length - keep;
      col.splice(keep, col.length - keep, `… ${hidden} more; enlarge the terminal`);
    }
  }

  for (let r = 0; r < contentRoom; r++) {
    // Row 0 is a spacer under the title; content starts on row 1.
    const body =
      r === 0
        ? ""
        : columns.map((col, i) => {
            const text = col[r - 1] ?? "";
            const w = i === columns.length - 1 ? innerW - colW * (columns.length - 1) : colW;
            // A two-cell gutter after every column but the last.
            const gutter = i === columns.length - 1 ? 0 : 2;
            return fit(paintLine(stripTrailing(text)), Math.max(0, w - gutter)) + " ".repeat(Math.min(gutter, w));
          }).join("");
    push(`${bc}${V}${on ? RESET : ""}${fit(body, innerW)}${bc}${V}${on ? RESET : ""}`);
  }

  const hint = ` ${HELP_CLOSE_HINT} `;
  const hintW = Math.min(hint.length, Math.max(0, innerW - 1));
  const hintText = hint.slice(0, hintW);
  push(`${bc}${BL}${H.repeat(Math.max(0, innerW - hintW))}${on ? RESET + dim() : ""}${hintText}${on ? RESET : ""}${bc}${BR}${on ? RESET : ""}`);

  for (let y = out.length; y < rows; y++) push("");
  return out.slice(0, rows);
}

/**
 * Flow help rows into as few columns as fit `room` rows: one column when it
 * fits, otherwise up to two (three on wide terminals) while each column stays
 * readable. Columns fill top to bottom; a section that continues in the next
 * column repeats its heading as `# Name (cont.)`, and a heading is never left
 * alone at the bottom of a column. Whatever still does not fit ends up in the
 * last column, where the caller announces it.
 */
function layoutColumns(lines: string[], room: number, innerW: number): string[][] {
  if (lines.length <= room || room < 2) return [lines];
  // As many columns as the widest row allows (plus its gutter), at most 3.
  const widest = Math.max(...lines.map((l) => l.length)) + 2;
  const maxCols = Math.max(1, Math.min(3, Math.floor((innerW + 2) / widest)));
  const cols: string[][] = [[]];
  let heading = "";
  for (const line of lines) {
    const isHeading = line.startsWith("#");
    if (isHeading) heading = line;
    let col = cols[cols.length - 1] as string[];
    const needs = isHeading ? 2 : 1;
    if (col.length + needs > room && cols.length < maxCols) {
      col = [];
      cols.push(col);
      if (!isHeading && heading) col.push(`${heading} (cont.)`);
    }
    col.push(line);
  }
  return cols;
}

function stripTrailing(text: string): string {
  return text.replace(/\s+$/u, "");
}