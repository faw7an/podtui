import { FOCUS_MARKER } from "../layout/constants.ts";
import { collapsedTitle, innerWidth, panelMetrics } from "../layout/panelView.ts";
import { computeColumns } from "../layout/computeColumns.ts";
import type { PanelLayout } from "../layout/types.ts";
import type { Theme } from "../../theme/theme.ts";
import { center, displayWidth, fit, padRight } from "../../util/fit.ts";
import { COLUMN_HEADERS, type PanelModel, type RowModel } from "../view/model.ts";
import { wrapText } from "./confirmDialog.ts";
import { bg, bold, dim, fg, paint, RESET } from "./palette.ts";

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

/**
 * Persistent "filter active" badge for the panel bottom border:
 * `⌕ web (3/6)`. The icon leads, so `fit()` truncation (which cuts the tail)
 * can never remove it; the count never collides with the title because it
 * lives here, not there. Meaning survives NO_COLOR: the text is the signal.
 */
export function formatFilterBadge(query: string, matched: number, total: number): string {
  return `⌕ ${query} (${matched}/${total})`;
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
    const count = panel.filter ? `${panel.items.length}/${panel.filter.total}` : panel.items.length;
    const text = collapsedTitle(FOCUS_MARKER, panel.number, panel.title, count);
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
  // A filtered panel takes the filter border even unfocused, so the state is
  // visible from afar; focus keeps accent because it is the primary signal.
  const border = focused ? theme.accent : panel.filter ? theme.filter : theme.border;
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
   *
   * `plain` suppresses every per-cell colour so the caller can wrap the whole
   * line in one SGR span (used for the selected row, where a nested RESET would
   * break the highlight).
   */
  const composeCells = (
    record: Record<string, string>,
    tone?: RowModel["tone"],
    dimAll = false,
    plain = false,
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
      if (plain) out += text;
      else if (dimAll) out += paint(text, [on ? dim() : ""]);
      else if (col.id === "state" && on && color) out += paint(text, [fg(color)]);
      else out += text;
      cursor += room;
    }
    return padRight(out, contentW);
  };

  const shown = windowRows(panel.items, panel.selected, m.dataRows);
  const headerCells = Object.fromEntries(colIds.map((id) => [id, COLUMN_HEADERS[id] ?? id]));

  const lines: string[] = [];

  // --- Top border: [N] Title matched/total (LAYOUT_SPEC §6) ---
  const count = panel.filter ? `${panel.items.length}/${panel.filter.total}` : `${panel.items.length}`;
  const titleText = fit(
    `[${panel.number}] ${panel.title} ${count}`,
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
        // A filter that matches nothing names the query and the way out,
        // centered so it reads as a state, not a row.
        const filtered = panel.items.length === 0 && panel.filter != null;
        const label =
          panel.items.length === 0
            ? (panel.filter != null
                ? `No matches for '${panel.filter.query}'  (Esc to clear)`
                : (panel.emptyLabel ?? "(empty)"))
            : undefined;
        // An explanation (e.g. where quadlets live) wraps over the empty rows
        // rather than being cut after one line; the last row that fits ends
        // with … if it still does not fit. A no-match filter stays one line.
        const wrapped = label !== undefined && !filtered && contentW >= 3 ? wrapText(label, contentW) : [];
        const room = m.innerRows - (header ? 1 : 0);
        const labelRow =
          filtered && slot === 0 && label !== undefined && contentW >= 3
            ? center(label, contentW)
            : slot >= 0 && slot < wrapped.length && slot < room
              ? slot === room - 1 && wrapped.length > room
                ? fit(`${wrapped[slot]} ${wrapped.slice(slot + 1).join(" ")}`, contentW)
                : fit(wrapped[slot] ?? "", contentW)
              : undefined;
        inner = " ".repeat(markerW) + (labelRow !== undefined ? paint(labelRow, [on ? dim() : ""]) : padRight("", contentW));
      } else {
        const isSelected = shown.offset + slot === panel.selected;
        if (isSelected && focused) {
          // One single SGR span across the whole padded row. The cells are
          // composed WITHOUT per-cell colour on purpose: a nested colour would
          // emit its own RESET and tear the highlight into patches. The
          // selection background/foreground come from the theme and are
          // explicit rather than relying on `inverse()`, so the row stays
          // readable whatever the terminal's default background happens to be.
          const plain = composeCells(item.cells, undefined, false, true);
          inner = paint(padRight(FOCUS_MARKER + plain, iw), [
            on ? bg(theme.selectionBg) : "",
            on ? fg(theme.selectionFg) : "",
            on ? bold() : "",
          ]);
        } else {
          const body = composeCells(item.cells, item.tone);
          // Remembered selection stays visible without a background.
          inner = isSelected ? `${paint(FOCUS_MARKER, [on ? dim() : ""])}${body}` : " ".repeat(markerW) + body;
        }
      }
    }
    lines.push(`${bc}${V}${on ? RESET : ""}${inner}${bc}${V}${on ? RESET : ""}`);
  }

  // --- Bottom border carries the filter badge (left) and the scroll hint
  // (right), so neither costs a data row. The badge is status and goes first;
  // the hint is convenience and is dropped when both do not fit. `fit()`
  // truncates the tail, so the leading ⌕ survives every width.
  const hint = scrollHint(shown.above, shown.below);
  const hintText = hint.length > 0 ? paint(` ${hint} `, [on ? dim() : ""]) : "";
  const badge =
    panel.filter != null && panel.filter.query !== ""
      ? formatFilterBadge(panel.filter.query, panel.items.length, panel.filter.total)
      : "";
  const hintKept = badge === "" || iw - displayWidth(hintText) >= 1;
  const shownHint = hintKept ? hintText : "";
  const badgeText =
    badge === "" ? "" : paint(fit(badge, Math.max(0, iw - displayWidth(shownHint))), [on ? fg(theme.filter) : ""]);
  const fill = Math.max(0, iw - displayWidth(badgeText) - displayWidth(shownHint));
  lines.push(`${bc}${BL}${badgeText}${H.repeat(fill)}${shownHint}${bc}${BR}${on ? RESET : ""}`);

  return lines;
}
