import type { Layout, Rect } from "../layout/types.ts";
import { innerWidth } from "../layout/panelView.ts";
import type { Theme } from "../../theme/theme.ts";
import { displayWidth, fit, padRight } from "../../util/fit.ts";
import type { DetailModel } from "../view/model.ts";
import { dim, fg, inverse, paint, RESET } from "./palette.ts";
import { windowRows } from "./panelLines.ts";

const TL = "╭";
const TR = "╮";
const BL = "└";
const BR = "┘";
const H = "─";
const V = "│";

export interface DetailOptions {
  theme: Theme;
  /** True when the detail pane owns the whole body (mode S / zoom). */
  prominent?: boolean;
  color?: boolean;
}

/**
 * Render the detail pane into exactly `rect.h` lines of exactly `rect.w` cells.
 *
 * Anatomy (LAYOUT_SPEC §7): border, title row, a one-row internal tab strip,
 * then windowed content. Long lines truncate with `…`; the renderer never
 * wraps, which is why Ink's wrapping can never add a row here.
 */
export function renderDetail(
  rect: Rect,
  detail: DetailModel,
  opts: DetailOptions,
): string[] {
  const { theme } = opts;
  const on = opts.color !== false;
  const w = rect.w;
  const iw = innerWidth(w);
  const bc = on ? fg(opts.prominent ? theme.accent : theme.border) : "";
  const lines: string[] = [];

  // Top border with the title.
  const title = fit(detail.title || "(no selection)", Math.max(0, iw - 1));
  const fill = Math.max(0, iw - displayWidth(title) - 1);
  lines.push(
    `${bc}${TL}${H}${on ? fg(opts.prominent ? theme.accent : theme.panelTitle) : ""}${title}${
      on ? RESET : ""
    }${bc}${H.repeat(fill)}${TR}${on ? RESET : ""}`,
  );

  const innerRows = Math.max(0, rect.h - 2);
  const tabText = detail.tabs
    .map((t, i) =>
      i === detail.activeTab ? paint(t, [on ? fg(theme.accent) : "", on ? inverse() : ""]) : paint(t, [on ? dim() : ""]),
    )
    .join(" ");
  const tabStrip = fit(tabText, iw);
  const hasTabs = detail.tabs.length > 0;

  const contentBudget = Math.max(0, innerRows - (hasTabs ? 1 : 0));
  const shown = windowRows(detail.lines, 0, contentBudget);
  const above = detail.lines.length - shown.rows.length;
  const aboveCount = shown.offset;

  for (let i = 0; i < innerRows; i++) {
    let inner: string;
    if (hasTabs && i === 0) {
      inner = padRight(tabStrip, iw);
    } else {
      const slot = i - (hasTabs ? 1 : 0);
      const line = slot >= 0 ? shown.rows[slot] : undefined;
      inner = line === undefined ? padRight("", iw) : padRight(fit(line, iw), iw);
    }
    lines.push(`${bc}${V}${on ? RESET : ""}${inner}${bc}${V}${on ? RESET : ""}`);
  }

  const hidden = above - aboveCount;
  const hint = hidden > 0 ? ` ↓${hidden} more ` : "";
  const hintText = hint.length > 0 ? paint(hint, [on ? dim() : ""]) : "";
  const bottomFill = Math.max(0, iw - displayWidth(hintText));
  lines.push(`${bc}${BL}${H.repeat(bottomFill)}${hintText}${bc}${BR}${on ? RESET : ""}`);

  return lines;
}

/** Centred message used for the TOO_SMALL breakpoint (LAYOUT_SPEC §5). */
export function renderMessage(
  layout: Layout,
  text: string,
  theme: Theme,
  color = true,
): string[] {
  const out: string[] = [];
  const mid = Math.floor(layout.rows / 2);
  const bc = color ? fg(theme.error) : "";
  out.push(paint(fit(text, layout.cols), color ? [bc] : []));
  // Pad to the full frame height so the row count stays exact.
  for (let i = 0; i < layout.rows; i++) {
    if (i === mid) continue;
    out[i] ??= " ".repeat(layout.cols);
  }
  return out.slice(0, layout.rows);
}
