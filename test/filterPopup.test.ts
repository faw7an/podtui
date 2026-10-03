import { describe, expect, test } from "bun:test";
import { computeLayout } from "../src/ui/layout/computeLayout.ts";
import {
  computeFilterPopupRect,
  FILTER_POPUP_H,
  FILTER_POPUP_MAX_W,
  FILTER_POPUP_MIN_W,
} from "../src/ui/layout/filterPopup.ts";
import { PANEL_IDS, type Layout, type PanelId } from "../src/ui/layout/types.ts";

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
    }
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