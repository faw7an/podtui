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

  const rows_: string[] = [];
  rows_.push("");
  for (const line of helpLines()) {
    rows_.push(line.startsWith("#") ? paint(line, [on ? fg(theme.accent) : "", on ? bold() : ""]) : line);
  }
  rows_.push("");
  rows_.push(paint(HELP_CLOSE_HINT, [on ? dim() : ""]));

  // Window the content to the box height (title + borders accounted for).
  const contentRoom = Math.max(0, boxH - 2);
  const shown = rows_.slice(0, contentRoom);

  for (const line of shown) {
    const body = fit(stripTrailing(line), innerW);
    push(`${bc}${V}${on ? RESET : ""}${body}${bc}${V}${on ? RESET : ""}`);
  }
  while (out.length < boxY + 1 + contentRoom) {
    push(`${bc}${V}${on ? RESET : ""}${" ".repeat(innerW)}${bc}${V}${on ? RESET : ""}`);
  }

  const bottomFill = Math.max(0, innerW);
  push(`${bc}${BL}${H.repeat(bottomFill)}${BR}${on ? RESET : ""}`);

  for (let y = out.length; y < rows; y++) push("");
  return out.slice(0, rows);
}

function stripTrailing(text: string): string {
  return text.replace(/\s+$/u, "");
}