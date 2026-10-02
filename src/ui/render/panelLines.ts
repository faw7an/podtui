import { FOCUS_MARKER } from "../layout/constants.ts";
import { collapsedTitle, innerWidth, panelMetrics } from "../layout/panelView.ts";
import { computeColumns } from "../layout/computeColumns.ts";
import type { PanelLayout } from "../layout/types.ts";
import type { Theme } from "../../theme/theme.ts";
import { displayWidth, fit, padRight } from "../../util/fit.ts";
import { COLUMN_HEADERS, type PanelModel, type RowModel } from "../view/model.ts";
import { bold, dim, fg, inverse, paint, RESET } from "./palette.ts";

/** Box-drawing characters, emitted directly for exact control. */
const TL = "╭";
const TR = "╮";
const BL = "└";
const BR = "┘";
const H = "─";
const V = "│";

export interface PanelRenderOptions {
  theme: Theme;
  focused: boolean;
  /** Set false for NO_COLOR frames and assertable plain output. */
  color?: boolean;
}

/**
 * Keep the selected row inside the window (LAYOUT_SPEC §9.7).
 * `above`/`below` count the items hidden off-screen, for the border hint.
 */
export function windowRows<T>(
  items: readonly T[],
  selected: number,
  maxRows: number,
): { rows: T[]; offset: number; above: number; below: number } {
  if (maxRows <= 0) return { rows: [], offset: 0, above: 0, below: items.length };
  if (items.length <= maxRows) return { rows: [...items], offset: 0, above: 0, below: 0 };
  const sel = Math.min(Math.max(0, selected), items.length - 1);
  let start = Math.min(Math.max(0, sel - Math.floor(maxRows / 2)), items.length - maxRows);
  if (sel < start) start = sel;
  if (sel >= start + maxRows) start = sel - maxRows + 1;
  start = Math.min(Math.max(0, start), items.length - maxRows);
  return {
    rows: items.slice(start, start + maxRows),
    offset: start,
    above: start,
    below: items.length - start - maxRows,
  };
}

export function scrollHint(above: number, below: number): string {
  if (above > 0 && below > 0) return `↑${above} ↓${below} more`;
  if (below > 0) return `↓${below} more`;
  if (above > 0) return `↑${above} more`;
  return "";
}

function toneColor(tone: RowModel["tone"], theme: Theme): string | undefined {
  switch (tone) {
    case "ok":
      return theme.statusOk;
    case "warn":
      return theme.statusWarn;
    case "error":
      return theme.statusError;
    case "info":
      return theme.accent;
    default:
      return undefined;
  }
}

export { toneColor };

/**
 * Render one panel into exactly `rect.h` lines of exactly `rect.w` cells.
 *
 * Short-panel rule comes from `panelMetrics` (LAYOUT_SPEC §6):
 *   h >= 6  bordered box with a column-header row
 *   h 4-5   bordered box, column header dropped for an extra data row
 *   h < 4   borderless one-line title strip
 */
export function renderPanel(
  rect: PanelLayout,
  panel: PanelModel,
  opts: PanelRenderOptions,
): string[] {
  const { theme, focused } = opts;
  const on = opts.color !== false;

  // --- Collapsed: borderless one-line strip (never a short bordered box) ---
  // The strip always carries the `▸` marker, per LAYOUT_SPEC §6: meaning must
  // survive with no colour. Bold+accent only when focused.
  if (rect.collapsed) {
    const text = collapsedTitle(FOCUS_MARKER, panel.number, panel.title, panel.items.length);
    const painted = focused
      ? paint(text, [on ? bold() : "", on ? fg(theme.accent) : ""])
      : paint(text, [on ? dim() : ""]);
    // A collapsed rect is normally 1 row; pad defensively so the contract
    // "exactly rect.h lines" always holds.
    return [padRight(painted, rect.w), ...new Array<string>(Math.max(0, rect.h - 1)).fill(padRight("", rect.w))];
  }

  const w = rect.w;
  const iw = innerWidth(w);
  const m = panelMetrics(rect.h);
  const border = focused ? theme.accent : theme.border;
  const bc = on ? fg(border) : "";

  // The 2-cell marker column is reserved on every data row so the marker never
  // eats the first characters of the name (that was a real bug once).
  const markerW = displayWidth(FOCUS_MARKER);
  const contentW = Math.max(0, iw - markerW);

  const layoutCols = computeColumns(contentW, panel.columns);
  const colIds = layoutCols?.columns.map((c) => c.id) ?? [];

  /**
   * Place each column's cell at the offset `computeColumns` assigned. Gaps
   * between columns are left blank — the widths already include them, so
   * subtracting a gap per cell would shave a character off every column.
   */
  const composeCells = (
    record: Record<string, string>,
    tone?: RowModel["tone"],
    dimAll = false,
  ): string => {
    if (!layoutCols) return padRight("", contentW);
    let out = "";
    let cursor = 0;
    for (const col of layoutCols.columns) {
      if (col.x > cursor) {
        const gapCells = Math.min(col.x - cursor, Math.max(0, contentW - cursor));
        out += " ".repeat(gapCells);
        cursor += gapCells;
      }
      // `cellW` already excludes the column's trailing gap, so cells never
      // butt up against each other.
      const room = Math.max(0, Math.min(col.cellW, contentW - cursor));
      if (room <= 0) break;
      const text = fit(record[col.id] ?? "", room);
      const color = toneColor(tone, theme);
      if (dimAll) out += paint(text, [on ? dim() : ""]);
      else if (col.id === "state" && on && color) out += paint(text, [fg(color)]);
      else out += text;
      cursor += room;
    }
    return padRight(out, contentW);
  };

  const shown = windowRows(panel.items, panel.selected, m.dataRows);
  const headerCells = Object.fromEntries(colIds.map((id) => [id, COLUMN_HEADERS[id] ?? id]));

  const lines: string[] = [];

  // --- Top border: [N] Title count (LAYOUT_SPEC §6) ---
  const titleText = fit(
    `[${panel.number}] ${panel.title} ${panel.items.length}`,
    Math.max(0, iw - 1),
  );
  const topFill = Math.max(0, iw - displayWidth(titleText) - 1);
  lines.push(
    `${bc}${TL}${H}${on ? fg(focused ? theme.accent : theme.panelTitle) : ""}${titleText}${
      on ? RESET : ""
    }${bc}${H.repeat(topFill)}${TR}${on ? RESET : ""}`,
  );

  // --- Body: optional column header, then windowed data rows ---
  const header = m.showHeader;

  for (let i = 0; i < m.innerRows; i++) {
    let inner: string;
    if (header && i === 0) {
      inner = " ".repeat(markerW) + composeCells(headerCells, undefined, true);
    } else {
      const slot = i - (header ? 1 : 0);
      const item = slot < 0 ? undefined : shown.rows[slot];
      if (!item) {
        // An empty panel says why, rather than looking like a rendering failure.
        const label = panel.items.length === 0 ? (panel.emptyLabel ?? "(empty)") : undefined;
        const empty = slot === 0 && label !== undefined && contentW >= 3;
        inner =
          " ".repeat(markerW) +
          (empty && label !== undefined ? paint(fit(label, contentW), [on ? dim() : ""]) : padRight("", contentW));
      } else {
        const isSelected = shown.offset + slot === panel.selected;
        const body = composeCells(item.cells, item.tone);
        if (isSelected && focused) {
          // Reverse video across the whole padded row: marker, text and the
          // trailing blanks all invert together.
          inner = paint(
            padRight(FOCUS_MARKER + body, iw),
            [on ? inverse() : "", on ? fg(theme.selectionBg) : "", on ? fg(theme.selectionFg) : ""],
          );
        } else if (isSelected) {
          // Remembered selection stays visible without reverse video.
          inner = `${paint(FOCUS_MARKER, [on ? dim() : ""])}${body}`;
        } else {
          inner = " ".repeat(markerW) + body;
        }
      }
    }
    lines.push(`${bc}${V}${on ? RESET : ""}${inner}${bc}${V}${on ? RESET : ""}`);
  }

  // --- Bottom border carries the scroll hint, so it costs no data row ---
  const hint = scrollHint(shown.above, shown.below);
  const hintText = hint.length > 0 ? paint(` ${hint} `, [on ? dim() : ""]) : "";
  const fill = Math.max(0, iw - displayWidth(hintText));
  lines.push(`${bc}${BL}${H.repeat(fill)}${hintText}${bc}${BR}${on ? RESET : ""}`);

  return lines;
}
