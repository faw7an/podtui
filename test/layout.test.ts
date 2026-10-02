import { describe, expect, test } from "bun:test";
import { computeColumns } from "../src/ui/layout/computeColumns";
import {
  allocatePanelHeights,
  breakpointFor,
  computeLayout,
  listWidthL,
  listWidthXL,
} from "../src/ui/layout/computeLayout";
import { collapsedTitle, desiredPanelHeight, innerWidth, panelMetrics } from "../src/ui/layout/panelView";
import {
  FIXED_CHROME_H,
  FOCUS_MARKER,
  MIN_COLS,
  MIN_DETAIL_W,
  MIN_PANEL_H,
  MIN_PANEL_W,
  MIN_ROWS,
} from "../src/ui/layout/constants";
import {
  initialState,
  reducer,
  resolveEscape,
  visibleOrder,
  type LayoutState,
} from "../src/ui/layout/layoutReducer";
import { PANEL_IDS, type PanelId, type Rect } from "../src/ui/layout/types";

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

const ALL = new Set<PanelId>(PANEL_IDS);
const ALL_IDS = [...PANEL_IDS];

/** The real sandbox shape: 6 containers, 2 images, 1 pod, 1 volume, ... */
const SANDBOX: Map<PanelId, number> = new Map<PanelId, number>([
  ["pods", 1],
  ["containers", 6],
  ["images", 2],
  ["volumes", 1],
  ["networks", 2],
  ["quadlets", 0],
]);

function uniformDemands(n: number): Map<PanelId, number> {
  return new Map(PANEL_IDS.map((id, i) => [id, (i % n) + 1]));
}

// ---------------------------------------------------------------- breakpoints

describe("breakpoints (LAYOUT_SPEC §5)", () => {
  test("match the spec table exactly", () => {
    // Too small
    expect(breakpointFor(39, 24)).toBe("TOO_SMALL");
    expect(breakpointFor(200, 9)).toBe("TOO_SMALL");
    // S: cols < 70
    expect(breakpointFor(40, 24)).toBe("S");
    expect(breakpointFor(60, 20)).toBe("S");
    expect(breakpointFor(69, 30)).toBe("S");
    // M: 70 <= cols < 110
    expect(breakpointFor(70, 30)).toBe("M");
    expect(breakpointFor(80, 24)).toBe("M");
    expect(breakpointFor(100, 30)).toBe("M");
    expect(breakpointFor(109, 30)).toBe("M");
    // L: 110 <= cols < 150
    expect(breakpointFor(110, 35)).toBe("L");
    expect(breakpointFor(120, 35)).toBe("L");
    expect(breakpointFor(149, 40)).toBe("L");
    // XL: cols >= 150
    expect(breakpointFor(150, 40)).toBe("XL");
    expect(breakpointFor(200, 50)).toBe("XL");
  });

  test("regression: the 120/100/40 drift is gone", () => {
    // Under the drifted constants (L>=120, M>=100, S>=40) these were M/M/S.
    // With the spec values they must be L/M/M.
    expect(breakpointFor(119, 30)).toBe("L");
    expect(breakpointFor(99, 24)).toBe("M");
    expect(breakpointFor(80, 24)).toBe("M");
    expect(breakpointFor(69, 24)).toBe("S");
  });

  test("mode L keeps the detail minimum width", () => {
    for (let cols = BREAKPOINT_L_MIN; cols < 150; cols++) {
      const w = listWidthL(cols);
      expect(cols - w).toBeGreaterThanOrEqual(MIN_DETAIL_W);
      expect(w).toBeGreaterThanOrEqual(40);
    }
  });

  test("mode XL uses a 2-column grid wide enough per column, else falls back", () => {
    for (let cols = 150; cols <= 400; cols++) {
      const listW = listWidthXL(cols);
      if (listW === null) continue;
      expect(Math.floor(listW / 2)).toBeGreaterThanOrEqual(MIN_PANEL_W);
      expect(cols - listW).toBeGreaterThanOrEqual(MIN_DETAIL_W);
    }
  });
});

const BREAKPOINT_L_MIN = 110;

// ------------------------------------------------------------- short-panel rule

describe("panelMetrics: short-panel rule (LAYOUT_SPEC §6)", () => {
  test("h >= 6 shows the column header", () => {
    for (const h of [6, 7, 8, 20, 47]) {
      const m = panelMetrics(h);
      expect(m.collapsed).toBe(false);
      expect(m.bordered).toBe(true);
      expect(m.showHeader).toBe(true);
      expect(m.dataRows).toBe(h - 3);
      expect(m.innerRows).toBe(h - 2);
    }
  });

  test("h = 4-5 drops the column header and gains a data row", () => {
    expect(panelMetrics(4)).toEqual({
      collapsed: false,
      bordered: true,
      showHeader: false,
      dataRows: 2,
      innerRows: 2,
    });
    expect(panelMetrics(5)).toEqual({
      collapsed: false,
      bordered: true,
      showHeader: false,
      dataRows: 3,
      innerRows: 3,
    });
  });

  test("h < 4 collapses to a borderless 1-row strip", () => {
    for (const h of [0, 1, 2, 3]) {
      const m = panelMetrics(h);
      expect(m.collapsed).toBe(true);
      expect(m.bordered).toBe(false);
      expect(m.showHeader).toBe(false);
      expect(m.dataRows).toBe(0);
    }
  });

  test("a bordered panel is never shorter than border + 1 data row", () => {
    for (let h = 0; h <= 60; h++) {
      const m = panelMetrics(h);
      if (m.bordered) expect(h).toBeGreaterThanOrEqual(MIN_PANEL_H);
      if (m.collapsed) expect(h).toBeLessThan(MIN_PANEL_H);
      if (m.showHeader) expect(m.dataRows).toBeGreaterThanOrEqual(3);
      expect(m.dataRows).toBeGreaterThanOrEqual(0);
    }
  });

  test("computeLayout never emits a bordered panel below MIN_PANEL_H", () => {
    for (let cols = MIN_COLS; cols <= 300; cols += 1) {
      for (let rows = MIN_ROWS; rows <= 80; rows += 1) {
        for (const n of [1, 2, 6]) {
          const layout = computeLayout({
            cols,
            rows,
            visible: ALL,
            focused: "containers",
            demands: uniformDemands(n),
          });
          for (const p of layout.panels) {
            if (p.collapsed) {
              expect(p.h).toBeLessThan(MIN_PANEL_H);
              expect(p.h).toBeGreaterThan(0);
            } else {
              expect(p.h).toBeGreaterThanOrEqual(MIN_PANEL_H);
            }
            expect(p.showHeader).toBe(p.h >= 6);
          }
        }
      }
    }
  });

  test("desiredPanelHeight never asks for less than a bordered box", () => {
    expect(desiredPanelHeight(0)).toBe(MIN_PANEL_H);
    expect(desiredPanelHeight(1)).toBe(4);
    expect(desiredPanelHeight(6)).toBe(9);
  });

  test("innerWidth accounts for both borders", () => {
    expect(innerWidth(20)).toBe(18);
    expect(innerWidth(2)).toBe(0);
    expect(innerWidth(1)).toBe(0);
  });

  test("collapsed title keeps the marker, number, label and count", () => {
    expect(collapsedTitle(FOCUS_MARKER, 3, "Images", 2)).toBe("▸ 3 Images (2)");
  });
});

// ------------------------------------------------------------ height allocation

describe("allocatePanelHeights", () => {
  test("heights sum to exactly available for every size", () => {
    for (let n = 1; n <= 8; n++) {
      for (let available = 1; available <= 160; available++) {
        const ids = ALL_IDS.slice(0, n) as PanelId[];
        const heights = allocatePanelHeights(ids, uniformDemands(3), available, "containers");
        const sum = [...heights.values()].reduce((a, b) => a + b, 0);
        expect(sum).toBe(available);
      }
    }
  });

  test("the focused panel is never collapsed", () => {
    for (let available = 1; available <= 160; available++) {
      for (let n = 1; n <= 8; n++) {
        const ids = ALL_IDS.slice(0, n) as PanelId[];
        for (const focus of ids) {
          const heights = allocatePanelHeights(ids, uniformDemands(2), available, focus);
          const h = heights.get(focus);
          expect(h).toBeDefined();
          if (available >= MIN_PANEL_H) {
            expect(h ?? 0).toBeGreaterThanOrEqual(MIN_PANEL_H);
          }
        }
      }
    }
  });

  test("accordion kicks in below n * MIN_PANEL_H and gives strips to the rest", () => {
    // 6 panels, 20 rows: 6 * 4 = 24 > 20.
    const heights = allocatePanelHeights(ALL_IDS, uniformDemands(2), 20, "containers");
    expect(heights.get("containers")).toBe(15); // 20 - 5 strips
    for (const id of ALL_IDS.filter((i) => i !== "containers")) {
      expect(heights.get(id)).toBe(1);
    }
  });

  test("panels are omitted when even strips cannot fit the focused panel", () => {
    // 6 panels, 7 rows: focused needs 4, so only 3 strips fit.
    const heights = allocatePanelHeights(ALL_IDS, uniformDemands(2), 7, "containers");
    expect(heights.get("containers")).toBe(4);
    expect(heights.size).toBe(4); // focused + 3 strips
    expect([...heights.values()].reduce((a, b) => a + b, 0)).toBe(7);
  });

  test("the lowest-priority panel is the one dropped", () => {
    const heights = allocatePanelHeights(ALL_IDS, uniformDemands(2), 7, "containers");
    expect(heights.has("quadlets")).toBe(false);
    expect(heights.has("pods")).toBe(true);
  });

  test("with no focus, the first panel is the protected one", () => {
    const heights = allocatePanelHeights(ALL_IDS, uniformDemands(2), 20, null);
    expect(heights.get("pods")).toBe(15);
  });

  test("panels expand toward their item count; leftover surplus goes to focus", () => {
    const heights = allocatePanelHeights(ALL_IDS, SANDBOX, 100, "containers");
    // Containers has 6 items -> desired 9, so it is at least that tall...
    expect(heights.get("containers") ?? 0).toBeGreaterThanOrEqual(9);
    // ...and is the tallest panel, absorbing the surplus the small lists do
    // not need (LAYOUT_SPEC §5 step 2: remainder to the focused panel).
    for (const id of ALL_IDS.filter((i) => i !== "containers")) {
      expect(heights.get("containers") ?? 0).toBeGreaterThan(heights.get(id) ?? 0);
    }
    expect([...heights.values()].reduce((a, b) => a + b, 0)).toBe(100);
  });

  test("no panel exceeds its desired height unless it is the focused one", () => {
    const heights = allocatePanelHeights(ALL_IDS, SANDBOX, 100, "containers");
    for (const id of ALL_IDS.filter((i) => i !== "containers")) {
      expect(heights.get(id)).toBe(desiredPanelHeight(SANDBOX.get(id) ?? 0));
    }
  });
});

// ---------------------------------------------------------------- computeLayout

describe("computeLayout invariants (LAYOUT_SPEC §9)", () => {
  const focusables = ["containers", "pods", "detail"] as const;

  for (const [cols, rows] of [
    [200, 50],
    [120, 35],
    [100, 30],
    [80, 24],
    [60, 20],
    [150, 40],
    [149, 40],
    [110, 24],
    [109, 12],
    [70, 24],
    [69, 24],
    [40, 10],
  ] as const) {
    test(`${cols}x${rows}: rects valid, contained, non-overlapping`, () => {
      const visibleSets = [
        ALL,
        new Set<PanelId>(["containers"]),
        new Set<PanelId>(["pods", "images"]),
      ];
      for (const visible of visibleSets) {
        for (const focus of focusables) {
          for (const demands of [SANDBOX, uniformDemands(4), new Map<PanelId, number>()]) {
            const layout = computeLayout({ cols, rows, visible, focused: focus, demands });
            const rects = [...layout.panels, ...(layout.detail ? [layout.detail] : [])];
            for (const r of rects) {
              expect(r.w).toBeGreaterThan(0);
              expect(r.h).toBeGreaterThan(0);
              expect(r.x).toBeGreaterThanOrEqual(0);
              expect(r.x + r.w).toBeLessThanOrEqual(cols);
              expect(contains(layout.content, r)).toBe(true);
            }
            for (let i = 0; i < rects.length; i++) {
              for (let j = i + 1; j < rects.length; j++) {
                const a = rects[i];
                const b = rects[j];
                if (a && b) expect(overlaps(a, b)).toBe(false);
              }
            }
            // Invariant 5: something is always visible.
            expect(rects.length).toBeGreaterThan(0);
          }
        }
      }
    });
  }

  test("body height is rows - 2 (header and footer are one row each)", () => {
    for (const [cols, rows] of [[200, 50], [120, 35], [80, 24], [40, 10]] as const) {
      const layout = computeLayout({ cols, rows, visible: ALL, focused: "containers" });
      expect(layout.content.h).toBe(rows - FIXED_CHROME_H);
      expect(layout.header?.h).toBe(1);
      expect(layout.footer?.h).toBe(1);
      expect(layout.content.y).toBe(1);
      expect(layout.footer?.y).toBe(rows - 1);
      expect(layout.content.y + layout.content.h).toBe(rows - 1);
    }
  });

  test("property sweep: every size keeps the invariants", () => {
    for (let cols = MIN_COLS; cols <= 320; cols++) {
      for (let rows = MIN_ROWS; rows <= 100; rows++) {
        const bp = breakpointFor(cols, rows);
        const layout = computeLayout({
          cols,
          rows,
          visible: ALL,
          focused: "containers",
          demands: uniformDemands(5),
        });
        if (bp === "TOO_SMALL") {
          expect(layout.message).toBeDefined();
          expect(layout.panels).toHaveLength(0);
          continue;
        }
        expect(layout.message).toBeUndefined();
        const rects = [...layout.panels, ...(layout.detail ? [layout.detail] : [])];
        expect(rects.length).toBeGreaterThan(0);
        for (const r of rects) {
          expect(r.w).toBeGreaterThan(0);
          expect(r.h).toBeGreaterThan(0);
          expect(contains(layout.content, r)).toBe(true);
        }
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i];
            const b = rects[j];
            if (a && b) expect(overlaps(a, b)).toBe(false);
          }
        }
      }
    }
  });

  test("columns tile their region exactly", () => {
    for (const [cols, rows] of [
      [200, 50],
      [150, 40],
      [120, 35],
      [100, 30],
      [80, 24],
    ] as const) {
      const layout = computeLayout({
        cols,
        rows,
        visible: ALL,
        focused: "containers",
        demands: SANDBOX,
      });
      if (!layout.list) continue;
      const byX = new Map<number, Rect[]>();
      for (const p of layout.panels) {
        const list = byX.get(p.x) ?? [];
        list.push(p);
        byX.set(p.x, list);
      }
      expect(byX.size).toBeGreaterThan(0);
      for (const col of byX.values()) {
        const first = col[0];
        if (!first) continue;
        expect(col.reduce((a, p) => a + p.h, 0)).toBe(layout.list.h);
        let y = layout.list.y;
        for (const p of col) {
          expect(p.y).toBe(y);
          y += p.h;
        }
      }
    }
  });

  test("XL lays panels out in 2 grid columns", () => {
    const layout = computeLayout({
      cols: 200,
      rows: 50,
      visible: ALL,
      focused: "containers",
      demands: SANDBOX,
    });
    expect(layout.breakpoint).toBe("XL");
    const xs = new Set(layout.panels.map((p) => p.x));
    expect(xs.size).toBe(2);
    expect(layout.detail).toBeDefined();
  });

  test("M puts the list band above the detail, both full width", () => {
    const layout = computeLayout({
      cols: 100,
      rows: 30,
      visible: ALL,
      focused: "containers",
      demands: SANDBOX,
    });
    expect(layout.breakpoint).toBe("M");
    expect(layout.detail).toBeDefined();
    expect(layout.detail?.w).toBe(100);
    expect(layout.list?.w).toBe(100);
    expect(layout.detail?.y).toBeGreaterThan(layout.list?.y ?? 0);
    expect(layout.detail?.y).toBe((layout.list?.y ?? 0) + (layout.list?.h ?? 0));
  });

  test("S shows only the focused panel, no detail, but detail is reachable", () => {
    const layout = computeLayout({
      cols: 60,
      rows: 20,
      visible: ALL,
      focused: "images",
      demands: SANDBOX,
    });
    expect(layout.breakpoint).toBe("S");
    expect(layout.panels).toHaveLength(1);
    expect(layout.panels[0]?.id).toBe("images");
    expect(layout.detail).toBeUndefined();
    // Enter -> detail full-screen, available at this size too.
    const opened = computeLayout({
      cols: 60,
      rows: 20,
      visible: ALL,
      focused: "detail",
      detailFullscreen: true,
    });
    expect(opened.panels).toHaveLength(0);
    expect(opened.detail).toEqual(opened.content);
  });

  test("detail is present in XL and L", () => {
    for (const [cols, rows] of [[200, 50], [150, 40], [120, 35], [110, 24]] as const) {
      const layout = computeLayout({ cols, rows, visible: ALL, focused: "containers", demands: SANDBOX });
      expect(layout.detail).toBeDefined();
      expect(layout.detail?.w).toBeGreaterThanOrEqual(MIN_DETAIL_W);
    }
  });

  test("TOO_SMALL draws nothing but a message", () => {
    const layout = computeLayout({ cols: 30, rows: 8, visible: ALL, focused: "containers" });
    expect(layout.breakpoint).toBe("TOO_SMALL");
    expect(layout.message?.text).toContain("Terminal too small");
    expect(layout.panels).toHaveLength(0);
  });

  test("hiding a panel gives its rows to the others", () => {
    const before = computeLayout({
      cols: 120,
      rows: 35,
      visible: ALL,
      focused: "containers",
      demands: SANDBOX,
    });
    const after = computeLayout({
      cols: 120,
      rows: 35,
      visible: new Set<PanelId>(ALL_IDS.filter((id) => id !== "images")),
      focused: "containers",
      demands: SANDBOX,
    });
    expect(after.panels.map((p) => p.id)).not.toContain("images");
    expect(after.panels.length).toBe(before.panels.length - 1);
    // The freed rows went somewhere.
    const beforeSum = before.panels.reduce((a, p) => a + p.h, 0);
    const afterSum = after.panels.reduce((a, p) => a + p.h, 0);
    expect(afterSum).toBe(beforeSum);
  });
});

// -------------------------------------------------------------- focus behaviour

describe("focus is size-independent", () => {
  test("focus never changes due to size", () => {
    const s: LayoutState = initialState();
    const focusBefore = s.focus;
    for (const [cols, rows] of [[200, 50], [120, 35], [100, 30], [60, 20], [40, 10]] as const) {
      computeLayout({ cols, rows, visible: s.visible, focused: s.focus, demands: SANDBOX });
    }
    expect(s.focus).toBe(focusBefore);
  });

  test("hiding the focused panel relocates focus to a visible one", () => {
    let s = initialState();
    s = reducer(s, { type: "focus", id: "pods" });
    s = reducer(s, { type: "toggle", id: "pods" });
    expect(s.focus).not.toBe("pods");
    expect(s.visible.has(s.focus as PanelId)).toBe(true);
  });

  test("hiding an unfocused panel leaves focus alone", () => {
    let s = initialState();
    s = reducer(s, { type: "focus", id: "images" });
    s = reducer(s, { type: "toggle", id: "volumes" });
    expect(s.focus).toBe("images");
  });

  test("cannot focus a hidden panel", () => {
    let s = initialState();
    s = reducer(s, { type: "toggle", id: "networks" });
    s = reducer(s, { type: "focus", id: "networks" });
    expect(s.focus).not.toBe("networks");
  });

  test("the focused panel is never emitted collapsed", () => {
    for (let rows = MIN_ROWS; rows <= 60; rows++) {
      for (const focus of ALL_IDS) {
        const layout = computeLayout({
          cols: 120,
          rows,
          visible: ALL,
          focused: focus,
          demands: uniformDemands(2),
        });
        const panel = layout.panels.find((p) => p.id === focus);
        if (panel) expect(panel.collapsed).toBe(false);
      }
    }
  });

  test("the focused panel carries focused: true and the others false", () => {
    const layout = computeLayout({
      cols: 120,
      rows: 35,
      visible: ALL,
      focused: "images",
      demands: SANDBOX,
    });
    expect(layout.panels.filter((p) => p.focused).map((p) => p.id)).toEqual(["images"]);
  });

  test("among equally-sized panels the focused one is never the smallest", () => {
    // Content drives growth, so a panel with many items may legitimately be
    // taller than the focused panel. The focus weight only decides ties.
    const equal = new Map<PanelId, number>(ALL_IDS.map((id) => [id, 3]));
    for (let rows = MIN_ROWS; rows <= 60; rows++) {
      for (const focus of ALL_IDS) {
        const heights = allocatePanelHeights(ALL_IDS, equal, rows, focus);
        const fh = heights.get(focus);
        if (fh === undefined) continue;
        for (const [id, h] of heights) {
          if (id === focus) continue;
          if (h === 1 && fh >= MIN_PANEL_H) continue; // collapsed strip
          expect(fh).toBeGreaterThanOrEqual(h);
        }
      }
    }
  });

  test("selection is remembered per panel across hide/show", () => {
    let s = initialState();
    s = { ...s, selected: { ...s.selected, containers: 4 } };
    s = reducer(s, { type: "toggle", id: "containers" });
    s = reducer(s, { type: "toggle", id: "containers" });
    expect(s.selected.containers).toBe(4);
  });

  test("visibleOrder follows the canonical order", () => {
    const s = initialState(["images", "pods"]);
    expect(visibleOrder(s)).toEqual(["pods", "images"]);
  });
});

// ------------------------------------------------------------- Enter / Esc flow

describe("mode S Enter/Esc flow", () => {
  test("Enter opens detail full-screen and moves focus to detail", () => {
    let s = initialState();
    s = reducer(s, { type: "openDetail" });
    expect(s.detailFullscreen).toBe(true);
    expect(s.focus).toBe("detail");
  });

  test("Esc returns to the list and restores the previous focus", () => {
    let s = initialState();
    s = reducer(s, { type: "focus", id: "images" });
    s = reducer(s, { type: "openDetail" });
    s = reducer(s, { type: "escape" });
    expect(s.detailFullscreen).toBe(false);
    expect(s.focus).toBe("images");
  });

  test("number keys still toggle/switch panels in the list view", () => {
    let s = initialState();
    s = reducer(s, { type: "activate", id: "images" });
    expect(s.focus).toBe("images");
    s = reducer(s, { type: "activate", id: "images" });
    expect(s.visible.has("images")).toBe(false);
    s = reducer(s, { type: "activate", id: "images" });
    expect(s.visible.has("images")).toBe(true);
  });

  test("activate re-shows a hidden panel and focuses it", () => {
    let s = initialState();
    s = reducer(s, { type: "toggle", id: "quadlets" });
    expect(s.visible.has("quadlets")).toBe(false);
    s = reducer(s, { type: "activate", id: "quadlets" });
    expect(s.visible.has("quadlets")).toBe(true);
    expect(s.focus).toBe("quadlets");
  });

  test("resize while in detail full-screen does not overwrite returnFocus", () => {
    let s = initialState();
    s = reducer(s, { type: "focus", id: "volumes" });
    s = reducer(s, { type: "openDetail" });
    s = reducer(s, { type: "nextTab" });
    s = reducer(s, { type: "escape" });
    expect(s.focus).toBe("volumes");
  });

  test("zoom fills the body and Esc restores", () => {
    let s = initialState();
    s = reducer(s, { type: "focus", id: "networks" });
    s = reducer(s, { type: "zoom" });
    expect(s.zoom).toBe("networks");
    const zoomed = computeLayout({
      cols: 120,
      rows: 35,
      visible: s.visible,
      focused: s.focus,
      zoom: s.zoom,
      demands: SANDBOX,
    });
    expect(zoomed.panels).toHaveLength(1);
    expect(zoomed.panels[0]).toMatchObject({ x: 0, y: 1, w: 120, h: 33 });
    s = reducer(s, { type: "escape" });
    expect(s.zoom).toBeNull();
  });

  test("zoom on detail takes the whole body", () => {
    const layout = computeLayout({
      cols: 120,
      rows: 35,
      visible: ALL,
      focused: "detail",
      zoom: "detail",
    });
    expect(layout.panels).toHaveLength(0);
    expect(layout.detail?.w).toBe(120);
    expect(layout.detail?.h).toBe(33);
  });

  test("M: z zooms either pane", () => {
    const list = computeLayout({
      cols: 100,
      rows: 30,
      visible: ALL,
      focused: "containers",
      zoom: "containers",
    });
    expect(list.panels).toHaveLength(1);
    expect(list.panels[0]?.w).toBe(100);
    const detail = computeLayout({
      cols: 100,
      rows: 30,
      visible: ALL,
      focused: "detail",
      zoom: "detail",
    });
    expect(detail.panels).toHaveLength(0);
    expect(detail.detail?.h).toBe(28);
  });
});

describe("Escape priority (LAYOUT_SPEC §4)", () => {
  test("dialog beats zoom", () => {
    const s = reducer(initialState(), { type: "zoom" });
    expect(resolveEscape(s, { dialogOpen: true })).toEqual({ type: "closeDialog" });
  });

  test("dialog beats detail full-screen", () => {
    const s = reducer(initialState(), { type: "openDetail" });
    expect(resolveEscape(s, { dialogOpen: true })).toEqual({ type: "closeDialog" });
  });

  test("zoom beats detail full-screen", () => {
    let s = reducer(initialState(), { type: "zoom" });
    s = { ...s, detailFullscreen: true, focus: "detail" };
    expect(resolveEscape(s, {})).toEqual({ type: "escape" });
  });

  test("detail full-screen beats the filter", () => {
    const s = reducer(initialState(), { type: "openDetail" });
    const clear = { type: "activate", id: "pods" } as const;
    expect(resolveEscape(s, { filterActive: true, clearFilter: clear })).toEqual({ type: "escape" });
  });

  test("the filter is cleared last", () => {
    const clear = { type: "activate", id: "pods" } as const;
    expect(resolveEscape(initialState(), { filterActive: true, clearFilter: clear })).toEqual(clear);
  });

  test("nothing to escape returns null", () => {
    expect(resolveEscape(initialState(), {})).toBeNull();
    expect(resolveEscape(initialState())).toBeNull();
    expect(resolveEscape(initialState(), { filterActive: true })).toBeNull();
  });
});

// ------------------------------------------------------------------ computeColumns

describe("computeColumns", () => {
  const specs = [
    { id: "name", minW: 12, flex: 3, priority: 100 },
    { id: "state", minW: 9, priority: 90 },
    { id: "image", minW: 10, flex: 2, priority: 50 },
    { id: "age", minW: 5, priority: 10 },
  ] as const;

  test("widths sum to exactly the available space", () => {
    for (let available = 1; available <= 200; available++) {
      const result = computeColumns(available, specs);
      if (!result) continue;
      expect(result.columns.reduce((a, c) => a + c.w, 0)).toBe(available);
    }
  });

  test("never squeezes a column below its minimum", () => {
    for (let available = 1; available <= 200; available++) {
      const result = computeColumns(available, specs);
      if (!result) continue;
      for (const c of result.columns) {
        const spec = specs.find((s) => s.id === c.id);
        expect(c.w).toBeGreaterThanOrEqual(spec?.minW ?? 0);
      }
    }
  });

  test("drops the lowest priority column first", () => {
    // Minimum widths plus 1-cell gaps: all four need 39, without age 33,
    // without age+image 22.
    expect(computeColumns(39, specs)?.dropped).toEqual([]);
    expect(computeColumns(38, specs)?.dropped).toEqual(["age"]);
    expect(computeColumns(32, specs)?.dropped).toEqual(["age", "image"]);
    expect(computeColumns(21, specs)?.dropped).toEqual(["age", "image", "state"]);
  });

  test("reserves a gap cell after every column but the last", () => {
    const result = computeColumns(80, specs);
    expect(result).not.toBeNull();
    const cols = result?.columns ?? [];
    for (const [i, col] of cols.entries()) {
      expect(col.gap).toBe(i === cols.length - 1 ? 0 : 1);
      expect(col.w).toBe(col.cellW + col.gap);
      expect(col.cellW).toBeGreaterThanOrEqual(specs.find((s) => s.id === col.id)?.minW ?? 0);
    }
  });

  test("x offsets are contiguous and ordered", () => {
    const result = computeColumns(80, specs);
    expect(result).not.toBeNull();
    let x = 0;
    for (const c of result?.columns ?? []) {
      expect(c.x).toBe(x);
      x += c.w;
    }
  });

  test("returns null when nothing fits", () => {
    expect(computeColumns(0, specs)).toBeNull();
    expect(computeColumns(5, specs)).toBeNull();
    expect(computeColumns(20, [])).toBeNull();
  });
});
