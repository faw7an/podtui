import {
  BODY_TOP_Y,
  FOCUS_HEIGHT_WEIGHT,
  FIXED_CHROME_H,
  FOOTER_H,
  GRID_COLUMNS_XL,
  HEADER_H,
  LIST_BAND_FRACTION_M,
  LIST_FRACTION_L,
  LIST_FRACTION_XL,
  LIST_MIN_W_L,
  MIN_COLS,
  MIN_DETAIL_H,
  MIN_DETAIL_W,
  MIN_PANEL_H,
  MIN_PANEL_W,
  MIN_ROWS,
  NORMAL_HEIGHT_WEIGHT,
} from "./constants";
import { BREAKPOINTS } from "./constants";
import { desiredPanelHeight, panelMetrics } from "./panelView";
import {
  PANEL_IDS,
  isPanelId,
  type Breakpoint,
  type Layout,
  type LayoutInput,
  type PanelId,
  type PanelLayout,
  type Rect,
} from "./types";

/** LAYOUT_SPEC §5. */
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

function makePanel(id: PanelId, rect: Rect, focused: boolean): PanelLayout {
  const m = panelMetrics(rect.h);
  return { id, ...rect, collapsed: m.collapsed, showHeader: m.showHeader, focused };
}

/**
 * Height allocation for one column of panels (LAYOUT_SPEC §5 + §6).
 *
 * Rules, in order:
 *  1. If `n * MIN_PANEL_H` fits, every panel is a bordered box: start at
 *     `MIN_PANEL_H`, then grow toward each panel's desired height by weight
 *     (focused 1.5, others 1.0). Surplus beyond every desired height goes to
 *     the focused panel so the column always tiles exactly.
 *  2. Otherwise accordion: non-focused panels collapse to 1-row strips and the
 *     focused panel takes the rest. The focused panel is NEVER collapsed.
 *  3. If the focused panel still cannot reach `MIN_PANEL_H`, lower-priority
 *     panels are omitted entirely (LAYOUT_SPEC §5 step 3).
 *
 * Returns only panels that were given at least one row. The returned heights
 * always sum to exactly `available`.
 */
export function allocatePanelHeights(
  ids: readonly PanelId[],
  demands: ReadonlyMap<PanelId, number>,
  available: number,
  focused: PanelId | null,
): Map<PanelId, number> {
  const out = new Map<PanelId, number>();
  if (ids.length === 0 || available <= 0) return out;

  // The focused panel is protected. With focus on detail, protect the first
  // panel so the column always has one expanded box.
  const protectedId: PanelId = focused && ids.includes(focused) ? focused : (ids[0] as PanelId);
  const pIdx = ids.indexOf(protectedId);
  const caps = ids.map((id) => desiredPanelHeight(demands.get(id) ?? 0));
  const weights = ids.map((id) => (id === protectedId ? FOCUS_HEIGHT_WEIGHT : NORMAL_HEIGHT_WEIGHT));

  // --- Rule 1: every panel can be a bordered box ---
  if (ids.length * MIN_PANEL_H <= available) {
    const heights = ids.map(() => MIN_PANEL_H);
    let remaining = available - ids.length * MIN_PANEL_H;

    while (remaining > 0) {
      let totalWeight = 0;
      let best = -1;
      let bestScore = -1;
      for (let i = 0; i < ids.length; i++) {
        const room = (caps[i] ?? MIN_PANEL_H) - (heights[i] ?? 0);
        if (room <= 0) continue;
        totalWeight += weights[i] ?? 1;
        const score = room * (weights[i] ?? 1);
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best === -1) break;
      const room = (caps[best] ?? MIN_PANEL_H) - (heights[best] ?? 0);
      const share = Math.max(1, Math.round((remaining * (weights[best] ?? 1)) / totalWeight));
      const grant = Math.min(room, remaining, share);
      heights[best] = (heights[best] ?? 0) + grant;
      remaining -= grant;
    }
    // Leftover surplus: the focused panel keeps growing past its desired height.
    if (remaining > 0) heights[pIdx] = (heights[pIdx] ?? 0) + remaining;

    ids.forEach((id, i) => out.set(id, heights[i] ?? 0));
    return out;
  }

  // --- Rules 2 + 3: accordion, omitting panels that cannot fit at all ---
  let keep = [...ids];
  for (;;) {
    const others = keep.filter((id) => id !== protectedId);
    const focusH = available - others.length;
    if (focusH >= MIN_PANEL_H || keep.length === 1) {
      out.set(protectedId, Math.max(0, focusH));
      for (const id of others) out.set(id, 1);
      return out;
    }
    // Drop the lowest-priority (latest in canonical order) extra panel.
    const victim = keep.filter((id) => id !== protectedId).pop();
    if (!victim) break;
    keep = keep.filter((id) => id !== victim);
  }
  out.set(protectedId, Math.max(0, available));
  return out;
}

/**
 * Place panels inside `area`, optionally split into side-by-side columns.
 * Columns are balanced by desired height; each column tiles `area.h` exactly.
 */
function placePanels(
  ids: readonly PanelId[],
  demands: ReadonlyMap<PanelId, number>,
  area: Rect,
  focused: PanelId | null,
  columns: number,
): PanelLayout[] {
  if (ids.length === 0 || area.w <= 0 || area.h <= 0) return [];

  const colCount = Math.max(1, Math.min(columns, ids.length));
  const colWidth = Math.floor(area.w / colCount);

  // Bucket by desired height, tallest first, into the emptiest column.
  const buckets: PanelId[][] = Array.from({ length: colCount }, () => []);
  const load = new Array<number>(colCount).fill(0);
  const order = ids
    .map((id, i) => ({ id, want: desiredPanelHeight(demands.get(id) ?? 0), i }))
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
    // Canonical order within the column.
    const colIds = ids.filter((id) => bucket.includes(id));
    const heights = allocatePanelHeights(colIds, demands, area.h, focused);
    let y = area.y;
    for (const id of colIds) {
      const h = heights.get(id) ?? 0;
      if (h <= 0) continue;
      out.push(makePanel(id, { x: colX, y, w: colW, h }, id === focused));
      y += h;
    }
  });

  return out.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
}

/** LAYOUT_SPEC §5: mode L list width (45% of cols, min 40, detail keeps 40). */
export function listWidthL(cols: number): number {
  const wanted = Math.max(LIST_MIN_W_L, Math.round(cols * LIST_FRACTION_L));
  return Math.min(wanted, Math.max(0, cols - MIN_DETAIL_W));
}

/** LAYOUT_SPEC §5: mode XL list width, or null when the grid is too narrow. */
export function listWidthXL(cols: number): number | null {
  const listW = Math.round(cols * LIST_FRACTION_XL);
  const colW = Math.floor(listW / GRID_COLUMNS_XL);
  if (colW < MIN_PANEL_W) return null;
  if (cols - listW < MIN_DETAIL_W) return null;
  return listW;
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
        text: `Terminal too small (need ≥ ${MIN_COLS}×${MIN_ROWS}, have ${cols}×${rows})`,
        tone: "warn",
      },
    };
  }

  // LAYOUT_SPEC §3: header (tabs inside it) and footer are one row each.
  const contentH = Math.max(1, rows - FIXED_CHROME_H);
  const content: Rect = { x: 0, y: BODY_TOP_Y, w: cols, h: contentH };
  const header: Rect = { x: 0, y: 0, w: cols, h: HEADER_H };
  const footer: Rect = { x: 0, y: rows - FOOTER_H, w: cols, h: FOOTER_H };

  const demands = input.demands ?? new Map<PanelId, number>();
  const panelIds = PANEL_IDS.filter((id) => input.visible.has(id));
  const focusedPanel =
    isPanelId(input.focused) && panelIds.includes(input.focused) ? input.focused : null;

  const base = { cols, rows, breakpoint: bp, content, header, footer };

  // `z` zoom: the zoomed pane owns the whole body (LAYOUT_SPEC §4).
  if (input.zoom === "detail") {
    return { ...base, panels: [], detail: { ...content } };
  }
  if (input.zoom && panelIds.includes(input.zoom)) {
    return { ...base, panels: [makePanel(input.zoom, { ...content }, input.zoom === focusedPanel)] };
  }
  // Mode S `Enter`: detail full-screen (LAYOUT_SPEC §5, mode S).
  if (input.detailFullscreen) {
    return { ...base, panels: [], detail: { ...content } };
  }

  // --- Mode S: single region. Only the focused list panel. ---
  if (bp === "S") {
    const target = focusedPanel ?? panelIds[0];
    if (!target) return { ...base, panels: [], detail: { ...content } };
    return { ...base, panels: [makePanel(target, { ...content }, target === focusedPanel)] };
  }

  // --- Mode M: list band on top, detail below, full width. ---
  if (bp === "M") {
    const maxBand = contentH - MIN_DETAIL_H;
    const bandH = clamp(
      Math.round(contentH * LIST_BAND_FRACTION_M),
      MIN_PANEL_H,
      Math.max(MIN_PANEL_H, maxBand),
    );
    const band: Rect = { x: content.x, y: content.y, w: content.w, h: bandH };
    const detailArea: Rect = {
      x: content.x,
      y: content.y + bandH,
      w: content.w,
      h: Math.max(0, contentH - bandH),
    };
    const columns = Math.max(1, Math.floor(content.w / MIN_PANEL_W));
    const panels = placePanels(panelIds, demands, band, focusedPanel, columns);
    return {
      ...base,
      list: band,
      panels,
      detail: detailArea.h >= MIN_DETAIL_H ? detailArea : undefined,
    };
  }

  // --- Mode XL: 2-column list grid (55%), detail on the right (45%). ---
  if (bp === "XL") {
    const listW = listWidthXL(cols);
    if (listW !== null) {
      const list: Rect = { x: 0, y: content.y, w: listW, h: contentH };
      const detailArea: Rect = { x: listW, y: content.y, w: cols - listW, h: contentH };
      return {
        ...base,
        list,
        panels: placePanels(panelIds, demands, list, focusedPanel, GRID_COLUMNS_XL),
        detail: detailArea,
      };
    }
    // Grid too narrow: fall through to mode L (LAYOUT_SPEC §5).
  }

  // --- Mode L: one list column (45%, min 40), detail on the right. ---
  const listW = listWidthL(cols);
  if (listW < LIST_MIN_W_L) {
    // Not enough width for a list plus a minimum-width detail: detail wins.
    return { ...base, panels: [], detail: { ...content } };
  }
  const list: Rect = { x: 0, y: content.y, w: listW, h: contentH };
  const detailArea: Rect = { x: listW, y: content.y, w: cols - listW, h: contentH };
  return {
    ...base,
    list,
    panels: placePanels(panelIds, demands, list, focusedPanel, 1),
    detail: detailArea,
  };
}
