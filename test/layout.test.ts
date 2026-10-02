import { describe, expect, test } from "bun:test";
import { computeColumns } from "../src/ui/layout/computeColumns";
import { allocateHeights, breakpointFor, computeLayout, sidebarWidthFor } from "../src/ui/layout/computeLayout";
import {
  FIXED_CHROME_H,
  MIN_COLS,
  MIN_PANEL_H,
  MIN_PANEL_W,
  MIN_ROWS,
} from "../src/ui/layout/constants";
import { reducer, initialState, type LayoutState } from "../src/ui/layout/layoutReducer";
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

function demands(n: number): Map<PanelId, number> {
  return new Map(PANEL_IDS.map((id, i) => [id, (i % n) + 1]));
}

describe("breakpoints", () => {
  test("classify the spec breakpoints", () => {
    expect(breakpointFor(200, 50)).toBe("XL");
    expect(breakpointFor(150, 40)).toBe("XL");
    expect(breakpointFor(149, 40)).toBe("L");
    expect(breakpointFor(120, 35)).toBe("L");
    expect(breakpointFor(119, 35)).toBe("M");
    expect(breakpointFor(100, 30)).toBe("M");
    expect(breakpointFor(99, 30)).toBe("S");
    expect(breakpointFor(40, 24)).toBe("S");
    expect(breakpointFor(39, 24)).toBe("TOO_SMALL");
    expect(breakpointFor(80, 9)).toBe("TOO_SMALL");
    expect(breakpointFor(80, MIN_ROWS)).toBe("S");
  });

  test("sidebar always leaves room for the detail pane", () => {
    for (let cols = MIN_COLS; cols <= 400; cols++) {
      const bp = breakpointFor(cols, 40);
      if (bp === "S" || bp === "TOO_SMALL") continue;
      const w = sidebarWidthFor(bp, cols);
      expect(w).toBeGreaterThan(0);
      expect(cols - w).toBeGreaterThanOrEqual(20);
    }
  });
});

describe("allocateHeights", () => {
  test("sums exactly to available for every size and count", () => {
    for (let n = 0; n <= 12; n++) {
      for (let available = 0; available <= 200; available++) {
        for (const demand of [0, 3, 30]) {
          const desired = Array.from({ length: n }, () => MIN_PANEL_H + demand);
          for (let focus = -1; focus < n; focus++) {
            const heights = allocateHeights(desired, available, focus);
            expect(heights.length).toBe(n);
            if (n === 0 || available <= 0) continue;
            // The sum is the hard invariant: panels must tile the area exactly.
            expect(heights.reduce((a, b) => a + b, 0)).toBe(available);
            // Every panel needs at least one cell to render a border. This is
            // only satisfiable when the area is at least as tall as the panel
            // count; below that the caller falls back to a single-panel mode
            // rather than emitting zero-height rects.
            if (available >= n) {
              for (const h of heights) expect(h).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });

  test("panels grow toward their desired height before borrowing", () => {
    // 2 panels, room for 20 rows each.
    const heights = allocateHeights([MIN_PANEL_H + 10, MIN_PANEL_H + 2], 60, 0);
    expect(heights[0]).toBeGreaterThan(heights[1] ?? 0);
    expect(heights.reduce((a, b) => a + b, 0)).toBe(60);
  });

  test("focused panel never shrinks below the others when space is tight", () => {
    const heights = allocateHeights([MIN_PANEL_H, MIN_PANEL_H, MIN_PANEL_H], 20, 1);
    expect(heights[1]).toBeGreaterThanOrEqual(heights[0] ?? 0);
    expect(heights.reduce((a, b) => a + b, 0)).toBe(20);
  });
});

describe("computeLayout invariants", () => {
  const focusables = ["containers", "detail"] as const;

  for (const [cols, rows] of [
    [200, 50],
    [120, 35],
    [100, 30],
    [80, 24],
    [60, 20],
    [150, 40],
    [149, 40],
    [110, 24],
    [99, 12],
    [40, 10],
  ] as const) {
    test(`${cols}x${rows} never overflows, never overlaps`, () => {
      for (const visible of [ALL, new Set<PanelId>(["containers"]), new Set<PanelId>(["pods", "images"])]) {
        for (const focus of focusables) {
          const layout = computeLayout({
            cols,
            rows,
            visible,
            focused: focus,
            demands: demands(6),
          });
          const rects = [...layout.panels, ...(layout.detail ? [layout.detail] : [])];
          for (const r of rects) {
            expect(r.w).toBeGreaterThan(0);
            expect(r.h).toBeGreaterThan(0);
            expect(r.x).toBeGreaterThanOrEqual(0);
            expect(r.y).toBeGreaterThanOrEqual(layout.content.y);
            expect(r.x + r.w).toBeLessThanOrEqual(cols);
            expect(r.y + r.h).toBeLessThanOrEqual(rows - FIXED_CHROME_H + layout.content.y);
            expect(contains(layout.content, r)).toBe(true);
          }
          for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
              const a = rects[i];
              const b = rects[j];
              if (!a || !b) continue;
              expect(overlaps(a, b)).toBe(false);
            }
          }
        }
      }
    });
  }

  test("column heights tile the sidebar exactly", () => {
    for (const [cols, rows] of [[200, 50], [120, 35], [110, 40]] as const) {
      const layout = computeLayout({
        cols,
        rows,
        visible: ALL,
        focused: "containers",
        demands: demands(6),
      });
      if (!layout.sidebar) continue;
      const byCol = new Map<number, Rect[]>();
      for (const p of layout.panels) {
        const list = byCol.get(p.x) ?? [];
        list.push(p);
        byCol.set(p.x, list);
      }
      expect(byCol.size).toBeGreaterThan(0);
      for (const list of byCol.values()) {
        const sum = list.reduce((a, p) => a + p.h, 0);
        expect(sum).toBe(list[0] ? layout.sidebar.h : 0);
        let y = layout.sidebar.y;
        for (const p of list) {
          expect(p.y).toBe(y);
          y += p.h;
        }
      }
    }
  });

  test("TOO_SMALL returns a message and draws no panels", () => {
    const layout = computeLayout({ cols: 30, rows: 8, visible: ALL, focused: "containers" });
    expect(layout.breakpoint).toBe("TOO_SMALL");
    expect(layout.message).toBeDefined();
    expect(layout.panels).toHaveLength(0);
  });

  test("fullscreen gives one pane the entire content area", () => {
    const layout = computeLayout({
      cols: 120,
      rows: 35,
      visible: ALL,
      focused: "containers",
      fullscreen: "detail",
    });
    expect(layout.panels).toHaveLength(0);
    expect(layout.detail).toEqual(layout.content);
  });

  test("narrow terminals never produce a zero-width panel", () => {
    for (let cols = MIN_COLS; cols <= 200; cols++) {
      for (const rows of [MIN_ROWS, 12, 24, 60]) {
        const layout = computeLayout({ cols, rows, visible: ALL, focused: "containers", demands: demands(4) });
        for (const p of layout.panels) {
          expect(p.w).toBeGreaterThan(0);
          expect(p.h).toBeGreaterThan(0);
        }
      }
    }
  });
});

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
      const sum = result.columns.reduce((a, c) => a + c.w, 0);
      expect(sum).toBe(available);
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
    // Exactly enough for name+state+image, not age.
    const tight = computeColumns(31, specs);
    expect(tight?.dropped).toEqual(["age"]);
    const tighter = computeColumns(21, specs);
    expect(tighter?.dropped).toEqual(["age", "image"]);
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
});

describe("layoutReducer", () => {
  test("toggle hides and shows, moving focus when needed", () => {
    let s: LayoutState = initialState();
    s = reducer(s, { type: "toggle", id: "pods" });
    expect(s.visible.has("pods")).toBe(false);
    s = reducer(s, { type: "toggle", id: "pods" });
    expect(s.visible.has("pods")).toBe(true);
  });

  test("refuses to hide the last visible panel", () => {
    let s = initialState(["containers"]);
    s = reducer(s, { type: "toggle", id: "containers" });
    expect(s.visible.has("containers")).toBe(true);
  });

  test("focus moves to a panel that is still visible", () => {
    let s = initialState();
    s = reducer(s, { type: "focus", id: "pods" });
    s = reducer(s, { type: "toggle", id: "pods" });
    expect(s.focus).not.toBe("pods");
  });

  test("exit fullscreen returns focus to the pane that owned it", () => {
    let s = initialState();
    s = reducer(s, { type: "fullscreen", id: "detail" });
    expect(s.fullscreen).toBe("detail");
    s = reducer(s, { type: "fullscreen", id: "detail" });
    expect(s.fullscreen).toBeNull();
    expect(s.focus).toBe("detail");
  });

  test("move cycles through visible panes and detail", () => {
    let s = initialState(["pods", "images"]);
    s = reducer(s, { type: "focus", id: "pods" });
    s = reducer(s, { type: "move", dir: 1 });
    expect(s.focus).toBe("images");
    s = reducer(s, { type: "move", dir: 1 });
    expect(s.focus).toBe("detail");
    s = reducer(s, { type: "move", dir: 1 });
    expect(s.focus).toBe("pods");
    s = reducer(s, { type: "move", dir: -1 });
    expect(s.focus).toBe("detail");
  });

  test("switching tabs clears fullscreen", () => {
    let s = initialState();
    s = reducer(s, { type: "fullscreen", id: "detail" });
    s = reducer(s, { type: "nextTab" });
    expect(s.fullscreen).toBeNull();
  });
});

describe("panel minimums", () => {
  test("MIN_PANEL_H accounts for border + column header", () => {
    expect(MIN_PANEL_H).toBe(4);
    expect(MIN_PANEL_W).toBeGreaterThan(0);
  });
});
