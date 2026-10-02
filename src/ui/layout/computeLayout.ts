import {
  DETAIL_CHROME_H,
  FOCUS_HEIGHT_WEIGHT,
  MIN_COLS,
  MIN_DETAIL_W,
  MIN_PANEL_H,
  MIN_PANEL_W,
  MIN_ROWS,
  NORMAL_HEIGHT_WEIGHT,
  SIDEBAR_FRACTION,
  SIDEBAR_MAX_W,
  SIDEBAR_MIN_W,
  FIXED_CHROME_H,
  FIXED_TOP_H,
  FOOTER_H,
  HEADER_H,
  TABS_H,
} from "./constants";
import { BREAKPOINTS } from "./constants";
import type { Breakpoint, Layout, LayoutInput, PanelId, PanelLayout, Rect } from "./types";

/** Classify the terminal size. */
export function breakpointFor(cols: number, rows: number): Breakpoint {
  if (cols < MIN_COLS || rows < MIN_ROWS) return "TOO_SMALL";
  if (cols >= BREAKPOINTS.XL) return "XL";
  if (cols >= BREAKPOINTS.L) return "L";
  if (cols >= BREAKPOINTS.M) return "M";
  return "S";
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function sidebarWidthFor(bp: Breakpoint, cols: number): number {
  if (bp === "S" || bp === "TOO_SMALL") return cols;
  const fraction = SIDEBAR_FRACTION[bp as "XL" | "L" | "M"];
  const raw = Math.round(cols * fraction);
  // Never starve the detail pane.
  const maxAllowed = Math.max(0, cols - MIN_DETAIL_W);
  return clamp(raw, Math.min(SIDEBAR_MIN_W, maxAllowed), Math.min(SIDEBAR_MAX_W, maxAllowed));
}

/**
 * Content-driven vertical allocation ("expand to fit", see DECISIONS.md).
 *
 * `available` cells are distributed across `n` panels:
 *   1. every panel starts at min(desired, MIN_PANEL_H)
 *   2. surplus is shared by weight (focused panel gets more)
 *   3. no panel grows past its own `desired`
 *   4. leftover surplus goes to the focused panel
 * Heights always sum to exactly `available`.
 */
export function allocateHeights(
  desired: readonly number[],
  available: number,
  focusedIndex: number,
): number[] {
  const n = desired.length;
  if (n === 0) return [];
  if (available <= 0) return new Array<number>(n).fill(0);

  const idx = focusedIndex >= 0 && focusedIndex < n ? focusedIndex : 0;
  const heights = desired.map((d) => Math.max(MIN_PANEL_H, d));
  const total = heights.reduce((a, b) => a + b, 0);

  // --- Surplus: everything fits, grow toward the budget (focused first) ---
  if (total <= available) {
    let spare = available - total;
    // Distribute surplus by weight, refreshing the denominator as we spend it
    // so the focused panel is favoured without the others starving.
    let remainingWeight = n - 1 + FOCUS_HEIGHT_WEIGHT;
    for (let i = 0; i < n && spare > 0 && remainingWeight > 0; i++) {
      const weight = i === idx ? FOCUS_HEIGHT_WEIGHT : NORMAL_HEIGHT_WEIGHT;
      const granted = Math.min(spare, Math.round((spare * weight) / remainingWeight));
      if (granted <= 0) continue;
      heights[i] = (heights[i] ?? 0) + granted;
      spare -= granted;
      remainingWeight -= weight;
    }
    if (spare > 0) heights[idx] = (heights[idx] ?? 0) + spare;
    return heights;
  }

  // --- Deficit: shrink toward MIN_PANEL_H, focused panel shrinks least ---
  const deficit = total - available;
  // Inverse weight: a higher weight means "protect this panel more", so it
  // absorbs a smaller share of the cut.
  const inv = heights.map((_, i) => 1 / (i === idx ? FOCUS_HEIGHT_WEIGHT : NORMAL_HEIGHT_WEIGHT));
  const totalInv = inv.reduce((a, b) => a + b, 0);

  for (let i = 0; i < n; i++) {
    const share = Math.round((deficit * (inv[i] ?? 1)) / totalInv);
    heights[i] = Math.max(MIN_PANEL_H, (heights[i] ?? 0) - share);
  }

  // --- Settle any rounding drift so the sum is exact ---
  let drift = heights.reduce((a, b) => a + b, 0) - available;
  while (drift > 0) {
    const i = heights.findIndex((h) => h > MIN_PANEL_H);
    if (i === -1) break;
    heights[i] = (heights[i] ?? 0) - 1;
    drift--;
  }
  while (drift < 0) {
    heights[idx] = (heights[idx] ?? 0) + 1;
    drift++;
  }

  // --- Hard floor: the area can be shorter than n * MIN_PANEL_H. Panels then
  // shrink below the minimum, always taking a row from the currently tallest
  // panel so the cut stays even rather than emptying one panel. A panel left
  // with 0 rows is dropped by the caller (see panelsRect). ---
  let over = heights.reduce((a, b) => a + b, 0) - available;
  while (over > 0) {
    let tallest = -1;
    let best = 0;
    for (let i = 0; i < n; i++) {
      const h = heights[i] ?? 0;
      if (h <= 0) continue;
      if (h > best || (h === best && i === idx)) {
        best = h;
        tallest = i;
      }
    }
    if (tallest === -1) break;
    heights[tallest] = best - 1;
    over--;
  }
  return heights;
}

function panelsRect(
  panels: PanelId[],
  demands: ReadonlyMap<PanelId, number>,
  area: Rect,
  focused: PanelId | null,
  minW: number,
  maxColumns = 1,
): PanelLayout[] {
  if (panels.length === 0 || area.w <= 0 || area.h <= 0) return [];

  // The vertical sidebar stacks panels in a single column (LAYOUT_SPEC §2).
  // The horizontal band in mode M places them side by side instead.
  const fits = Math.max(1, Math.floor(area.w / Math.max(minW, 1)));
  const colCount = Math.max(1, Math.min(maxColumns, fits, panels.length));
  const colWidth = Math.floor(area.w / colCount);

  // Deal panels into columns, balanced by desired height (tallest first).
  const buckets: PanelId[][] = Array.from({ length: colCount }, () => []);
  const load = new Array<number>(colCount).fill(0);
  const order = panels
    .map((id, i) => ({ id, want: MIN_PANEL_H + Math.max(0, demands.get(id) ?? 0), i }))
    .sort((a, b) => b.want - a.want || a.i - b.i);
  for (const item of order) {
    let target = 0;
    for (let c = 1; c < colCount; c++) {
      if ((load[c] ?? 0) < (load[target] ?? 0)) target = c;
    }
    buckets[target]?.push(item.id);
    load[target] = (load[target] ?? 0) + item.want;
  }

  const out: PanelLayout[] = [];
  buckets.forEach((bucket, c) => {
    if (bucket.length === 0) return;
    const colX = area.x + c * colWidth;
    const colW = c === colCount - 1 ? area.w - c * colWidth : colWidth;

    // Keep canonical order within a column, then allocate this column's rows.
    const ids = panels.filter((id) => bucket.includes(id));
    const wants = ids.map((id) => MIN_PANEL_H + Math.max(0, demands.get(id) ?? 0));
    const focusIdx = focused ? ids.indexOf(focused) : -1;
    const heights = allocateHeights(wants, area.h, focusIdx);

    let y = area.y;
    ids.forEach((id, i) => {
      const h = heights[i] ?? 0;
      // A panel with no room is not rendered at all rather than drawn as a
      // zero-height rect (which would overdraw its neighbour's border).
      if (h > 0) {
        out.push({ id, x: colX, y, w: colW, h, collapsed: h < MIN_PANEL_H });
        y += h;
      }
    });
  });

  // Restore the canonical display order.
  return out.sort((a, b) => panels.indexOf(a.id) - panels.indexOf(b.id));
}

export function computeLayout(input: LayoutInput): Layout {
  const { cols, rows } = input;
  const bp = breakpointFor(cols, rows);

  if (bp === "TOO_SMALL") {
    return {
      cols,
      rows,
      breakpoint: bp,
      content: { x: 0, y: 0, w: cols, h: rows },
      panels: [],
      message: {
        text: `terminal too small (${cols}x${rows}, need ${MIN_COLS}x${MIN_ROWS})`,
        tone: "warn",
      },
    };
  }

  const contentH = Math.max(1, rows - FIXED_CHROME_H);
  const content: Rect = { x: 0, y: FIXED_TOP_H, w: cols, h: contentH };

  const header: Rect = { x: 0, y: 0, w: cols, h: HEADER_H };
  const tabs: Rect = { x: 0, y: HEADER_H, w: cols, h: TABS_H };
  const footer: Rect = { x: 0, y: rows - FOOTER_H, w: cols, h: FOOTER_H };

  const visible = input.visible;
  const panelIds = (["pods", "containers", "images", "volumes", "networks", "quadlets"] as PanelId[]).filter(
    (id) => visible.has(id),
  );
  const focusedPanel =
    input.focused !== "detail" && panelIds.includes(input.focused) ? input.focused : null;

  const base = { cols, rows, breakpoint: bp, content, header, tabs, footer };

  // Escape hatch: a single pane owns the whole content area.
  if (input.fullscreen === "detail") {
    return { ...base, sidebar: undefined, panels: [], detail: { ...content } };
  }
  if (input.fullscreen && panelIds.includes(input.fullscreen)) {
    return {
      ...base,
      panels: [
        { id: input.fullscreen, x: content.x, y: content.y, w: content.w, h: content.h, collapsed: false },
      ],
    };
  }

  // Mode S: one column, no split. Show the focused panel, else the detail.
  if (bp === "S") {
    if (focusedPanel) {
      return {
        ...base,
        panels: [
          { id: focusedPanel, x: content.x, y: content.y, w: content.w, h: content.h, collapsed: false },
        ],
      };
    }
    return { ...base, sidebar: undefined, panels: [], detail: { ...content } };
  }

  // Mode M: the panel band moves to the top, detail sits underneath.
  if (bp === "M") {
    const bandH = clamp(Math.round(contentH * 0.5), MIN_PANEL_H + 1, Math.max(MIN_PANEL_H + 1, contentH - DETAIL_CHROME_H));
    const band: Rect = { x: content.x, y: content.y, w: content.w, h: bandH };
    const detailArea: Rect = {
      x: content.x,
      y: content.y + bandH,
      w: content.w,
      h: Math.max(0, contentH - bandH),
    };
    const panels = panelsRect(
      panelIds,
      input.demands ?? new Map(),
      band,
      focusedPanel,
      MIN_PANEL_W * 2,
      // Side-by-side panels in the band, as many as the width allows.
      Math.max(1, panelIds.length),
    );
    return { ...base, sidebar: band, panels, detail: detailArea.h > 0 ? detailArea : undefined };
  }

  // Modes XL / L: vertical sidebar (stacked panels) + detail on the right.
  const sidebarW = sidebarWidthFor(bp, cols);
  const sidebar: Rect = { x: 0, y: content.y, w: sidebarW, h: contentH };
  const detailArea: Rect = {
    x: sidebarW,
    y: content.y,
    w: cols - sidebarW,
    h: contentH,
  };
  const panels = panelsRect(panelIds, input.demands ?? new Map(), sidebar, focusedPanel, MIN_PANEL_W);
  return { ...base, sidebar, panels, detail: detailArea.w >= MIN_DETAIL_W ? detailArea : undefined };
}
