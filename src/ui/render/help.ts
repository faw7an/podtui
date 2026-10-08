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
  const overflow = Math.max(0, Math.max(...columns.map((c) => c.length)) - (contentRoom - 1));
  if (overflow > 0 && contentRoom > 1) {
    const col = columns[columns.length - 1];
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
            return fit(paintLine(stripTrailing(text)), w);
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
 * Split help rows into as few columns as fit `room` rows (at most two, and
 * only if each column stays wide enough to read). Breaks happen only at
 * section headings, so a section is never split across columns. If even two
 * columns overflow, the overflow is cut, but the close hint is safe in the
 * border.
 */
function layoutColumns(lines: string[], room: number, innerW: number): string[][] {
  if (lines.length <= room || innerW < 60) return [lines];
  const sections: string[][] = [];
  for (const line of lines) {
    if (line.startsWith("#") || sections.length === 0) sections.push([]);
    sections[sections.length - 1]?.push(line);
  }
  // Best split: the section boundary that minimises the taller column.
  let best: [string[], string[]] = [lines, []];
  let bestH = Infinity;
  for (let i = 1; i < sections.length; i++) {
    const left = sections.slice(0, i).flat();
    const right = sections.slice(i).flat();
    const h = Math.max(left.length, right.length);
    if (h < bestH) {
      bestH = h;
      best = [left, right];
    }
  }
  return best[1].length > 0 ? best : [lines];
}

function stripTrailing(text: string): string {
  return text.replace(/\s+$/u, "");
}