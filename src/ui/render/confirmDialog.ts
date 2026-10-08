import type { Rect } from "../layout/types.ts";
import type { Theme } from "../../theme/theme.ts";
import { displayWidth, fit } from "../../util/fit.ts";
import type { ConfirmDialogState } from "../view/confirmDialog.ts";
import { bg, bold, dim, fg, paint, RESET } from "./palette.ts";

/**
 * The confirm dialog box (P4-T6). Pure, exact-size: `rect.h` lines of
 * `rect.w` cells, drawn over the frame like the filter popup.
 *
 *   ╭─ Remove container? ──────────╮
 *   │                              │
 *   │ Remove container web.        │
 *   │ It is running: it will be …  │
 *   │                              │
 *   │      [ Cancel ]  [ Remove ]  │
 *   └─────── y confirm · n/Esc cancel ┘
 *
 * Long target lists WRAP rather than truncate: the dialog's job is to name
 * exactly what goes, so a cut-off name would defeat it.
 */

const TL = "╭";
const TR = "╮";
const BL = "└";
const BR = "┘";
const H = "─";
const V = "│";
const HINT = " y confirm · n/Esc cancel ";

export const DIALOG_MAX_W = 64;

/** Word-wrap plain text to `width` cells; overlong words are hard-split. */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [];
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    let w = word;
    while (displayWidth(w) > width) {
      if (line) {
        out.push(line);
        line = "";
      }
      let cut = "";
      for (const ch of w) {
        if (displayWidth(cut + ch) > width) break;
        cut += ch;
      }
      out.push(cut);
      w = w.slice(cut.length);
    }
    const next = line ? `${line} ${w}` : w;
    if (displayWidth(next) > width) {
      out.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
  return out;
}

/** Body lines (wrapped) for a dialog of inner width `iw`. */
export function dialogBody(state: ConfirmDialogState, iw: number): string[] {
  return state.content.lines.flatMap((l) => wrapText(l, Math.max(1, iw - 2)));
}

/** Rect for the dialog, centred in the frame body; null if it cannot fit. */
export function dialogRect(cols: number, rows: number, state: ConfirmDialogState): Rect | null {
  const w = Math.min(DIALOG_MAX_W, cols - 4);
  if (w < 30) return null;
  const body = dialogBody(state, w - 2);
  // border + blank + body + blank + buttons + border
  const h = Math.min(rows - 2, body.length + 5);
  if (h < 6) return null;
  return { x: Math.floor((cols - w) / 2), y: Math.max(1, Math.floor((rows - h) / 2)), w, h };
}

export function renderConfirmDialog(rect: Rect, state: ConfirmDialogState, theme: Theme, on: boolean): string[] {
  const iw = Math.max(0, rect.w - 2);
  const bc = on ? fg(theme.error) : "";
  const R = on ? RESET : "";
  const out: string[] = [];

  const title = fit(` ${state.content.title} `, Math.max(0, iw - 1));
  out.push(`${bc}${TL}${H}${R}${paint(title, on ? [bold(), fg(theme.error)] : [])}${bc}${H.repeat(Math.max(0, iw - 1 - displayWidth(title)))}${TR}${R}`);

  const row = (text: string): string => `${bc}${V}${R}${fit(text, iw)}${bc}${V}${R}`;
  const body = dialogBody(state, iw);
  const bodyRoom = Math.max(0, rect.h - 5);
  out.push(row(""));
  const shown = body.length > bodyRoom ? [...body.slice(0, Math.max(0, bodyRoom - 1)), `… ${body.length - bodyRoom + 1} more lines`] : body;
  for (let i = 0; i < bodyRoom; i++) out.push(row(` ${shown[i] ?? ""}`));
  out.push(row(""));

  const button = (label: string, focused: boolean): string =>
    focused
      ? paint(`[ ${label} ]`, on ? [bg(label === "Cancel" ? theme.accent : theme.error), fg(theme.selectionFg), bold()] : [])
      : `[ ${label} ]`;
  // Without colour the focused button is still unmistakable: it is marked.
  const mark = (label: string, focused: boolean): string => (on ? button(label, focused) : `${focused ? ">" : " "}${button(label, false)}`);
  const buttons = `${mark("Cancel", state.focus === "cancel")}  ${mark(state.content.confirmLabel, state.focus === "confirm")}`;
  const pad = Math.max(0, iw - displayWidth(buttons) - 1);
  out.push(row(`${" ".repeat(pad)}${buttons}`));

  const hint = HINT.length <= iw ? HINT : "";
  out.push(`${bc}${BL}${H.repeat(Math.max(0, iw - hint.length))}${R}${hint ? paint(hint, on ? [dim()] : []) : ""}${bc}${BR}${R}`);
  return out;
}
