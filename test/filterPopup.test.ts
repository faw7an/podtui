import { describe, expect, test } from "bun:test";
import { computeLayout } from "../src/ui/layout/computeLayout.ts";
import {
  computeFilterPopupRect,
  FILTER_POPUP_H,
  FILTER_POPUP_MAX_W,
  FILTER_POPUP_MIN_W,
} from "../src/ui/layout/filterPopup.ts";
import { PANEL_IDS, type Layout, type PanelId } from "../src/ui/layout/types.ts";
import { PANEL_COLUMNS, panelMeta, type FrameModel } from "../src/ui/view/model.ts";
import { renderFrame } from "../src/ui/render/frame.ts";
import { LineBuffer } from "../src/ui/render/compose.ts";
import {
  renderFilterBar,
  renderFilterPopup,
  visibleQueryTail,
} from "../src/ui/render/filterPopup.ts";
import { stripAnsi, visibleWidth } from "../src/ui/render/palette.ts";
import { defaultTheme } from "../src/theme/theme.ts";

/**
 * The filter popup rect is derived from the computed Layout, never measured
 * fresh — so it inherits the inside-the-body discipline (LAYOUT_SPEC §9.1).
 * Matrix mirrors the canonical layout sizes.
 */

const ALL = new Set<PanelId>(PANEL_IDS);
const SIZES: readonly (readonly [number, number])[] = [
  [200, 50],
  [120, 35],
  [80, 24],
  [60, 20],
  [40, 10],
];

function insideBody(layout: Layout, rect: { x: number; y: number; w: number; h: number }): boolean {
  return (
    rect.w > 0 &&
    rect.h > 0 &&
    rect.x >= 0 &&
    rect.y >= 1 &&
    rect.x + rect.w <= layout.cols &&
    rect.y + rect.h <= layout.rows - 1
  );
}

describe("computeFilterPopupRect", () => {
  test("a popup fits over the focused panel at every canonical size", () => {
    for (const [cols, rows] of SIZES) {
      const layout = computeLayout({ cols, rows, visible: ALL, focused: "containers" });
      const placed = computeFilterPopupRect(layout, "containers");
      expect(placed.kind).toBe("popup");
      if (placed.kind !== "popup") continue;
      const panel = layout.panels.find((p) => p.id === "containers")!;
      expect(placed.rect.h).toBe(FILTER_POPUP_H);
      expect(placed.rect.w).toBe(Math.min(panel.w - 4, FILTER_POPUP_MAX_W));
      expect(insideBody(layout, placed.rect)).toBe(true);
      // Horizontally centered over the panel (±1 for integer rounding).
      const panelCx = panel.x + panel.w / 2;
      const popupCx = placed.rect.x + placed.rect.w / 2;
      expect(Math.abs(panelCx - popupCx)).toBeLessThanOrEqual(1);
      // Vertically centered, then biased one row down for clearance above
      // the box — clamped to the body at the extremes.
      const centered = panel.y + Math.floor((panel.h - FILTER_POPUP_H) / 2);
      const bottom = layout.rows - 1 - FILTER_POPUP_H;
      expect(placed.rect.y).toBe(Math.min(Math.max(1, centered + 1), bottom));
    }
  });

  test("the popup sits one row below the old center", () => {
    // Regression pin for the breathing-room offset: at 120x35 the containers
    // panel leaves ample room, so the +1 bias must show exactly.
    const layout = computeLayout({ cols: 120, rows: 35, visible: ALL, focused: "containers" });
    const panel = layout.panels.find((p) => p.id === "containers")!;
    const placed = computeFilterPopupRect(layout, "containers");
    expect(placed.kind).toBe("popup");
    if (placed.kind !== "popup") return;
    const centered = panel.y + Math.floor((panel.h - FILTER_POPUP_H) / 2);
    expect(placed.rect.y).toBe(centered + 1);
    expect(placed.rect.y).toBeGreaterThan(panel.y);
  });

  test("works for every panel, not just containers", () => {
    const layout = computeLayout({ cols: 120, rows: 35, visible: ALL, focused: "images" });
    for (const id of PANEL_IDS) {
      const placed = computeFilterPopupRect(layout, id);
      if (placed.kind !== "popup") continue;
      expect(insideBody(layout, placed.rect)).toBe(true);
    }
    // At 120x35 every visible panel gets a real popup, not a fallback.
    for (const id of PANEL_IDS) {
      expect(computeFilterPopupRect(layout, id).kind).toBe("popup");
    }
  });

  test("TOO_SMALL yields none: the message owns the frame", () => {
    const layout = computeLayout({ cols: 30, rows: 8, visible: ALL, focused: "containers" });
    expect(layout.message).toBeDefined();
    expect(computeFilterPopupRect(layout, "containers")).toEqual({ kind: "none" });
  });

  test("detail fullscreen has no panel rect, so the footer bar takes over", () => {
    const layout = computeLayout({
      cols: 60,
      rows: 20,
      visible: ALL,
      focused: "detail",
      detailFullscreen: true,
    });
    expect(layout.panels.find((p) => p.id === "containers")).toBeUndefined();
    expect(computeFilterPopupRect(layout, "containers")).toEqual({ kind: "bar" });
  });

  test("a too-narrow panel falls back to the bar", () => {
    const base = computeLayout({ cols: 40, rows: 10, visible: ALL, focused: "containers" });
    const panel = base.panels.find((p) => p.id === "containers")!;
    const squeezed: Layout = {
      ...base,
      panels: [{ ...panel, w: FILTER_POPUP_MIN_W - 5 }],
    };
    expect(computeFilterPopupRect(squeezed, "containers")).toEqual({ kind: "bar" });
  });

  test("no footer and no room means none, never a broken rect", () => {
    const base = computeLayout({ cols: 40, rows: 10, visible: ALL, focused: "containers" });
    const stripped: Layout = { ...base, footer: undefined };
    const panel = stripped.panels.find((p) => p.id === "containers")!;
    const squeezed: Layout = {
      ...stripped,
      panels: [{ ...panel, w: 10 }],
    };
    expect(computeFilterPopupRect(squeezed, "containers")).toEqual({ kind: "none" });
  });

  test("minimum size still fits a popup, never a bar", () => {
    const layout = computeLayout({ cols: 40, rows: 10, visible: ALL, focused: "containers" });
    const placed = computeFilterPopupRect(layout, "containers");
    expect(placed.kind).toBe("popup");
  });
});
describe("renderFilterPopup", () => {
  const data = { panelTitle: "Containers", query: "web", matched: 3, total: 6 };

  test("emits exactly 4 rows of exactly w cells", () => {
    for (const w of [24, 30, 44, 60]) {
      const lines = renderFilterPopup({ x: 0, y: 0, w, h: 4 }, data, defaultTheme, false);
      expect(lines).toHaveLength(4);
      for (const line of lines) expect(visibleWidth(line)).toBe(w);
    }
  });

  test("shows title, query with cursor, hints and N/M", () => {
    const text = stripAnsi(renderFilterPopup({ x: 0, y: 0, w: 44, h: 4 }, data, defaultTheme, false).join("\n"));
    expect(text).toContain("Filter: Containers");
    expect(text).toContain("> web▌");
    expect(text).toContain("Enter apply");
    expect(text).toContain("Esc clear");
    expect(text).toContain("3/6");
  });

  test("all four corners survive at every width", () => {
    for (const w of [24, 30, 36, 44, 60]) {
      const lines = renderFilterPopup({ x: 0, y: 0, w, h: 4 }, data, defaultTheme, false);
      const top = stripAnsi(lines[0] ?? "");
      const bottom = stripAnsi(lines[lines.length - 1] ?? "");
      expect(top.startsWith("╭")).toBe(true);
      expect(top.endsWith("╮")).toBe(true);
      expect(bottom.startsWith("└")).toBe(true);
      expect(bottom.endsWith("┘")).toBe(true);
    }
  });

  test("a long query shows its tail, never pushing the cursor out", () => {
    const long = { ...data, query: "a-very-long-query-string-that-overflows" };
    const lines = renderFilterPopup({ x: 0, y: 0, w: 30, h: 4 }, long, defaultTheme, false);
    const text = stripAnsi(lines.join("\n"));
    expect(text).toContain("…");
    expect(text).toContain("▌");
    expect(text).not.toContain("a-very-long");
    for (const line of lines) expect(visibleWidth(line)).toBe(30);
  });

  test("an empty query still shows the cursor", () => {
    const text = stripAnsi(
      renderFilterPopup({ x: 0, y: 0, w: 30, h: 4 }, { ...data, query: "" }, defaultTheme, false).join("\n"),
    );
    expect(text).toContain("> ▌");
  });

  test("colour off means zero escapes; colour on paints but keeps widths", () => {
    const plain = renderFilterPopup({ x: 0, y: 0, w: 44, h: 4 }, data, defaultTheme, false).join("\n");
    expect(plain).not.toContain("");
    const coloured = renderFilterPopup({ x: 0, y: 0, w: 44, h: 4 }, data, defaultTheme, true).join("\n");
    expect(coloured).toContain("[");
    expect(stripAnsi(coloured)).toBe(plain);
  });

  test("a degenerate width degrades without crashing", () => {
    expect(renderFilterPopup({ x: 0, y: 0, w: 0, h: 4 }, data, defaultTheme, false)).toEqual([]);
    const tiny = renderFilterPopup({ x: 0, y: 0, w: 10, h: 4 }, data, defaultTheme, false);
    expect(tiny).toHaveLength(4);
    for (const line of tiny) expect(visibleWidth(line)).toBe(10);
  });
});

describe("renderFilterBar", () => {
  const data = { panelTitle: "Containers", query: "web", matched: 3, total: 6 };

  test("fits exactly and names everything", () => {
    for (const w of [40, 60, 100]) {
      const line = renderFilterBar(w, data, defaultTheme, false);
      expect(visibleWidth(line)).toBe(w);
    }
    const text = stripAnsi(renderFilterBar(100, data, defaultTheme, false));
    expect(text).toContain("Filter Containers:");
    expect(text).toContain("web▌");
    expect(text).toContain("3/6");
    expect(text).toContain("Enter apply");
    expect(text).toContain("Esc clear");
  });

  test("colour off means zero escapes", () => {
    expect(renderFilterBar(60, data, defaultTheme, false)).not.toContain("");
  });
});

describe("visibleQueryTail", () => {
  test("short queries pass through; overflow shows the tail", () => {
    expect(visibleQueryTail("web", 10)).toBe("web");
    expect(visibleQueryTail("abcdef", 4)).toBe("…def");
    expect(visibleQueryTail("abcdef", 1)).toBe("…");
    expect(visibleQueryTail("abcdef", 0)).toBe("");
  });
});

describe("renderFrame filter overlay composition", () => {
  function filteredModel(): FrameModel {
    const panels = PANEL_IDS.map((id) => ({
      id,
      ...panelMeta(id),
      columns: PANEL_COLUMNS[id],
      items:
        id === "containers"
          ? [
              { id: "a", tone: "ok" as const, cells: { name: "web", state: "running" } },
              { id: "b", tone: "ok" as const, cells: { name: "chatty", state: "running" } },
            ]
          : [],
      selected: 0,
      ...(id === "containers" ? { filter: { query: "web", total: 2 } } : {}),
    }));
    return {
      panels,
      focus: "containers" as const,
      clock: "",
      detail: { title: "t", tabs: [], activeTab: 0, lines: [] },
    };
  }

  test("popup draws over the frame; footer stays normal", () => {
    const layout = computeLayout({ cols: 80, rows: 24, visible: ALL, focused: "containers" });
    const lines = renderFrame(layout, filteredModel(), {
      theme: defaultTheme,
      color: false,
      filterPopup: "containers",
    });
    expect(lines).toHaveLength(24);
    for (const line of lines) expect(visibleWidth(line)).toBe(80);
    const text = lines.join("\n");
    expect(text).toContain("Filter: Containers");
    expect(text).toContain("> web▌");
    // The normal footer is untouched by the popup variant.
    expect(text).toContain("q");
  });

  test("bar replaces the footer when no box fits", () => {
    const layout = computeLayout({
      cols: 60,
      rows: 20,
      visible: ALL,
      focused: "detail",
      detailFullscreen: true,
    });
    const lines = renderFrame(layout, filteredModel(), {
      theme: defaultTheme,
      color: false,
      filterPopup: "containers",
    });
    expect(lines).toHaveLength(20);
    for (const line of lines) expect(visibleWidth(line)).toBe(60);
    const footer = lines[lines.length - 1] ?? "";
    expect(footer).toContain("Filter Containers:");
    expect(footer).toContain("Enter apply");
  });

  test("no popup flag means a normal frame", () => {
    const layout = computeLayout({ cols: 80, rows: 24, visible: ALL, focused: "containers" });
    const text = renderFrame(layout, filteredModel(), { theme: defaultTheme, color: false }).join("\n");
    expect(text).not.toContain("Filter:");
  });

  test("TOO_SMALL never draws the popup", () => {
    const layout = computeLayout({ cols: 30, rows: 8, visible: ALL, focused: "containers" });
    const lines = renderFrame(layout, filteredModel(), {
      theme: defaultTheme,
      color: false,
      filterPopup: "containers",
    });
    expect(lines.join("\n")).not.toContain("Filter:");
  });
});

describe("LineBuffer.excise", () => {
  test("clears a rect so an overlay drawn there wins every cell", () => {
    const buffer = new LineBuffer(20, 5);
    buffer.write(0, 2, "0123456789abcdefghij");
    buffer.excise(5, 2, 6, 1);
    buffer.write(5, 2, "XXXXXX");
    const lines = buffer.toLines();
    expect(lines[2]).toBe("01234XXXXXXbcdefghij");
  });

  test("rows outside the rect are untouched", () => {
    const buffer = new LineBuffer(10, 3);
    buffer.write(0, 0, "aaaaaaaaaa");
    buffer.write(0, 1, "bbbbbbbbbb");
    buffer.excise(2, 1, 4, 1);
    const lines = buffer.toLines();
    expect(lines[0]).toBe("aaaaaaaaaa");
    expect(lines[1]).toBe("bb    bbbb");
    expect(lines[2]).toBe("          ");
  });

  test("a zero area excision changes nothing", () => {
    const buffer = new LineBuffer(10, 2);
    buffer.write(0, 0, "hello");
    buffer.excise(2, 0, 0, 1);
    buffer.excise(2, 0, 3, 0);
    expect(buffer.toLines()[0]?.slice(0, 5)).toBe("hello");
  });
});
