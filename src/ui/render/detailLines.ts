import type { Layout, Rect } from "../layout/types.ts";
import { innerWidth } from "../layout/panelView.ts";
import type { Theme } from "../../theme/theme.ts";
import { displayWidth, fit, padRight } from "../../util/fit.ts";
import type { DetailModel } from "../view/model.ts";
import { LABEL_W } from "../view/detail.ts";
import { bg, bold, dim, fg, paint, RESET } from "./palette.ts";

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
  /** Content scroll offset in rows (PgUp/PgDn); clamped to the content. */
  scroll?: number;
}

/**
 * Paint one content row: section headings bold in the accent colour, the
 * fixed-width key cell in the accent colour, values default. A row only gets
 * the key treatment when the key cell boundary is exact (cell 13 is a space):
 * overlong keys fall back to plain rather than tearing mid-key. Placeholders
 * (`no selection`, `not implemented yet`) match neither rule and stay plain.
 */
function paintContent(line: string, theme: Theme, on: boolean): string {
  if (!on) return line;
  if (line.startsWith("# ")) return paint(line, [fg(theme.accent), bold()]);
  if (line.length > LABEL_W && line[LABEL_W - 1] === " ") {
    return paint(line.slice(0, LABEL_W), [fg(theme.accent)]) + line.slice(LABEL_W);
  }
  return line;
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
      i === detail.activeTab
        ? paint(t, [on ? bg(theme.accent) : "", on ? fg(theme.selectionFg) : "", on ? bold() : ""])
        : paint(t, [on ? dim() : ""]),
    )
    .join(" ");
  const tabStrip = fit(tabText, iw);
  const hasTabs = detail.tabs.length > 0;

  const contentBudget = Math.max(0, innerRows - (hasTabs ? 1 : 0));
  // Pager semantics, not selection-follow: the offset is the top row, clamped
  // so the last window is full. (windowRows centers its anchor instead, which
  // is what panels want and detail does not.)
  const lastTop = Math.max(0, detail.lines.length - contentBudget);
  const top = Math.min(Math.max(0, opts.scroll ?? 0), lastTop);
  const rows = detail.lines.slice(top, top + contentBudget);

  for (let i = 0; i < innerRows; i++) {
    let inner: string;
    if (hasTabs && i === 0) {
      inner = padRight(tabStrip, iw);
    } else {
      const slot = i - (hasTabs ? 1 : 0);
      const line = slot >= 0 ? rows[slot] : undefined;
      inner = line === undefined ? padRight("", iw) : padRight(fit(paintContent(line, theme, on), iw), iw);
    }
    lines.push(`${bc}${V}${on ? RESET : ""}${inner}${bc}${V}${on ? RESET : ""}`);
  }

  const hiddenBelow = detail.lines.length - top - rows.length;
  const hint = hiddenBelow > 0 ? ` ↓${hiddenBelow} more ` : "";
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
