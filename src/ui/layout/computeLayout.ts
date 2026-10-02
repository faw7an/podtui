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
import { panelMetrics } from "./panelView";
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
 * Height allocation for one column of panels (LAYOUT_SPEC §5).
 *
 * Heights are distributed purely **by weight** (focused 1.5, others 1.0). They
 * deliberately do NOT depend on item counts: a panel that grows when containers
 * appear and shrinks when they stop would make the whole frame jump on every
 * refresh, which is far worse than a few blank rows. The focused panel still
 * gets its larger share, and lists that do not fit are windowed with a scroll
 * hint (LAYOUT_SPEC §6).
 *
 * Rules, in order:
 *  1. If `n * MIN_PANEL_H` fits, split `available` by weight, round each to
 *     the nearest row, and settle the integer remainder: positive drift goes to
 *     the focused panel, negative drift is taken from the tallest panel.
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
  available: number,
  focused: PanelId | null,
): Map<PanelId, number> {
  const out = new Map<PanelId, number>();
  if (ids.length === 0 || available <= 0) return out;

  // The focused panel is the only one with a larger share. A column that does
  // not contain the focus splits its height evenly, so unfocused panels always
  // look alike. (Accordion still needs someone to expand, so it falls back to
  // the first panel of the column.)
  const hasFocus = focused !== null && ids.includes(focused);
  const protectedId: PanelId = hasFocus ? (focused as PanelId) : (ids[0] as PanelId);
  const pIdx = ids.indexOf(protectedId);
  const weights = ids.map((id) => (hasFocus && id === focused ? FOCUS_HEIGHT_WEIGHT : NORMAL_HEIGHT_WEIGHT));

  // --- Rule 1: every panel can be a bordered box ---
  if (ids.length * MIN_PANEL_H <= available) {
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const raw = ids.map((_, i) => (available * (weights[i] ?? 1)) / totalWeight);
    const heights = raw.map((v) => Math.floor(v));

    // Largest-remainder apportionment for the integer rows left over by
    // flooring: hand them to the panels whose share was rounded down hardest,
    // ties going to the focused panel. Dumping the whole remainder on the
    // focused panel instead would push it well past its 1.5x weight whenever
    // the rounding favours a sibling.
    let drift = available - heights.reduce((a, b) => a + b, 0);
    if (drift > 0) {
      const order = raw
        .map((v, i) => ({ i, frac: v - Math.floor(v) }))
        .sort((a, b) => b.frac - a.frac || (a.i === pIdx ? -1 : b.i === pIdx ? 1 : 0));
      for (const { i } of order) {
        if (drift <= 0) break;
        heights[i] = (heights[i] ?? 0) + 1;
        drift -= 1;
      }
    }
    while (drift < 0) {
      let tallest = -1;
      let best = 0;
      for (let i = 0; i < ids.length; i++) {
        const h = heights[i] ?? 0;
        if (h <= MIN_PANEL_H) continue;
        if (h > best) {
          best = h;
          tallest = i;
        }
      }
      if (tallest === -1) break;
      heights[tallest] = best - 1;
      drift += 1;
    }

    // Rounding can leave a panel under the minimum (many small panels). Raise
    // the offenders and take the rows back from the tallest, always cutting the
    // currently tallest panel so the column stays even.
    let over = heights.reduce((a, b) => a + b, 0) - available;
    for (let i = 0; i < ids.length && over < 0; i++) {
      if ((heights[i] ?? 0) >= MIN_PANEL_H) continue;
      const need = MIN_PANEL_H - (heights[i] ?? 0);
      heights[i] = MIN_PANEL_H;
      over += need;
    }
    while (over > 0) {
      let tallest = -1;
      let best = 0;
      for (let i = 0; i < ids.length; i++) {
        const h = heights[i] ?? 0;
        if (h <= 0) continue;
        if (h > best || (h === best && i === pIdx)) {
          best = h;
          tallest = i;
        }
      }
      if (tallest === -1) break;
      heights[tallest] = best - 1;
      over -= 1;
    }

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
  area: Rect,
  focused: PanelId | null,
  columns: number,
): PanelLayout[] {
  if (ids.length === 0 || area.w <= 0 || area.h <= 0) return [];

  const colCount = Math.max(1, Math.min(columns, ids.length));
  const colWidth = Math.floor(area.w / colCount);

  // Deal panels round-robin into the emptiest column, preserving canonical
  // order, so the columns are balanced and stable across refreshes.
  const buckets: PanelId[][] = Array.from({ length: colCount }, () => []);
  const load = new Array<number>(colCount).fill(0);
  ids.forEach((id, i) => {
    let target = 0;
    for (let c = 1; c < colCount; c++) {
      if ((load[c] ?? 0) < (load[target] ?? 0)) target = c;
    }
    buckets[target]?.push(id);
    load[target] = (load[target] ?? 0) + 1;
    void i;
  });

  const out: PanelLayout[] = [];
  buckets.forEach((bucket, c) => {
    if (bucket.length === 0) return;
    const colX = area.x + c * colWidth;
    const colW = c === colCount - 1 ? area.w - c * colWidth : colWidth;
    // Canonical order within the column.
    const colIds = ids.filter((id) => bucket.includes(id));
    const heights = allocatePanelHeights(colIds, area.h, focused);
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
    const panels = placePanels(panelIds, band, focusedPanel, columns);
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
        panels: placePanels(panelIds, list, focusedPanel, GRID_COLUMNS_XL),
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
    panels: placePanels(panelIds, list, focusedPanel, 1),
    detail: detailArea,
  };
}
