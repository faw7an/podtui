import type { Rect } from "../layout/types.ts";
import type { Theme } from "../../theme/theme.ts";
import { displayWidth, fit } from "../../util/fit.ts";
import { bold, dim, fg, paint, RESET } from "./palette.ts";

/**
 * The `/` filter popup (redesigned filter UX): a small bordered box drawn over
 * the frame at the rect `computeFilterPopupRect` produced, plus a 1-row bar
 * variant that replaces the footer row when no box fits.
 *
 * Same discipline as every other renderer: exact-size output, every line
 * through `fit()`, no measurement by Ink. Colors come only from the theme;
 * with color off the box-drawing characters remain (they are text, not
 * colour) and zero escapes are emitted.
 */

const TL = "╭";
const TR = "╮";
const BL = "└";
const BR = "┘";
const H = "─";
const V = "│";
/** Block cursor shown after the query text; width verified as 1 in-session. */
const CURSOR = "▌";

export interface FilterPopupData {
  /** Panel display name, e.g. "Containers". */
  panelTitle: string;
  query: string;
  matched: number;
  total: number;
}

export const FILTER_POPUP_H = 4;

function inner(w: number): number {
  return Math.max(0, w - 2);
}

/**
 * The visible tail of the query: when it overflows, the head (not the cursor
 * end) is replaced with `…`, so typing stays visible at narrow widths.
 * Grapheme-safe via Intl.Segmenter, the same as fit.ts tokenization.
 */
const segmenter = new Intl.Segmenter();

function takeRightCells(text: string, width: number): string {
  if (width <= 0) return "";
  const parts = Array.from(segmenter.segment(text), (s) => s.segment);
  let used = 0;
  const kept: string[] = [];
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i] ?? "";
    const w = displayWidth(part);
    if (used + w > width) break;
    kept.unshift(part);
    used += w;
  }
  return kept.join("");
}

export function visibleQueryTail(query: string, width: number): string {
  if (width <= 0) return "";
  if (displayWidth(query) <= width) return query;
  if (width === 1) return "…";
  return "…" + takeRightCells(query, width - 1);
}

export function renderFilterPopup(
  rect: Rect,
  data: FilterPopupData,
  theme: Theme,
  color = true,
): string[] {
  const on = color;
  const { w } = rect;
  const iw = inner(w);
  const out: string[] = [];
  if (w <= 0) return out;

  const bc = on ? fg(theme.accent) : "";
  const reset = on ? RESET : "";
  // Title plus fill occupy exactly iw-1 cells between the leading ╭─ and the
  // corner: fitting the title any wider would push the total past w and the
  // final fit() would eat the ╮ (a real bug caught by the corner test below).
  const title = fit(`Filter: ${data.panelTitle}`, Math.max(0, iw - 1));
  out.push(
    `${bc}${TL}${H}${on ? bold() : ""}${title}${reset}${bc}${H.repeat(Math.max(0, iw - 1 - displayWidth(title)))}${TR}${reset}`,
  );

  const tail = visibleQueryTail(data.query, Math.max(0, iw - 3));
  const inputText = fit(`> ${tail}${CURSOR}`, iw);
  out.push(`${bc}${V}${reset}${inputText}${bc}${V}${reset}`);

  const counts = `${data.matched}/${data.total} matches`;
  const hintText = fit(`Enter apply  Esc clear · ${counts}`, iw);
  const hint = on ? paint(hintText, [dim()]) : hintText;
  out.push(`${bc}${V}${reset}${hint}${bc}${V}${reset}`);

  out.push(`${bc}${BL}${H.repeat(Math.max(0, iw))}${BR}${reset}`);

  while (out.length < FILTER_POPUP_H) out.push(" ".repeat(w));
  return out.slice(0, FILTER_POPUP_H).map((line) => fit(line, w));
}

/**
 * The 1-row fallback: replaces the footer row when the focused panel has no
 * rect (detail fullscreen) or is too narrow for a box.
 */
export function renderFilterBar(
  width: number,
  data: FilterPopupData,
  theme: Theme,
  color = true,
): string {
  if (width <= 0) return "";
  const on = color;
  const tail = visibleQueryTail(data.query, Math.max(0, width - 40));
  const text = `Filter ${data.panelTitle}: ${tail}${CURSOR} (${data.matched}/${data.total}) · Enter apply · Esc clear`;
  const fitted = fit(text, width);
  return on ? paint(fitted, [fg(theme.accent)]) : fitted;
}

