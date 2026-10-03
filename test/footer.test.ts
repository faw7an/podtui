import { describe, expect, test } from "bun:test";
import { buildFooter } from "../src/ui/render/chrome.ts";
import { stripAnsi, visibleWidth } from "../src/ui/render/palette.ts";
import { computeLayout } from "../src/ui/layout/computeLayout.ts";
import { PANEL_IDS, type PanelId } from "../src/ui/layout/types.ts";
import {
  PANEL_COLUMNS,
  panelMeta,
  type FrameModel,
  type RowModel,
} from "../src/ui/view/model.ts";
import { defaultTheme } from "../src/theme/theme.ts";
import { KEYMAP } from "../src/ui/view/help.ts";

/**
 * P2-T8: the footer shows context-sensitive key hints.
 *
 * Before this, `buildFooter` rendered one fixed hint list everywhere: with the
 * detail pane fullscreen it still advertised `1-6 panel` and `Enter inspect`,
 * which do nothing useful there, and never mentioned `[ ]` or `Esc back` —
 * the two keys that actually matter. The context derives from the model
 * (`focus === "detail"` exactly when fullscreen opens), so no component
 * threading was needed.
 *
 * The R-17 no-drift rule applies to every context: the footer may only show
 * keys that exist in KEYMAP, which the `?` overlay renders.
 */

const PLAIN = { theme: defaultTheme, color: false };
const ALL = new Set<PanelId>(PANEL_IDS);

function row(id: string): RowModel {
  return { id, tone: "ok", cells: { name: id, state: "● running" } };
}

function model(focus: FrameModel["focus"]): FrameModel {
  return {
    panels: PANEL_IDS.map((id) => ({ id, ...panelMeta(id), columns: PANEL_COLUMNS[id], items: [row("a")], selected: 0 })),
    focus,
    clock: "9:40 PM",
    detail: {
      title: "a · running",
      tabs: ["Logs", "Stats", "Env", "Config", "Top"],
      activeTab: 0,
      lines: ["line one"],
    },
  };
}

function text(
  cols: number,
  focus: FrameModel["focus"],
  context?: "base" | "detail" | "filter",
): string {
  const layout = computeLayout({ cols, rows: 24, visible: ALL, focused: "containers" });
  return stripAnsi(buildFooter(layout, model(focus), { ...PLAIN, context }));
}

describe("footer hint contexts", () => {
  test("the list view advertises list keys, not detail keys", () => {
    const line = text(200, "containers");
    expect(line).toContain("1-6");
    expect(line).toContain("inspect");
    expect(line).not.toContain("[ ]");
  });

  test("the fullscreen detail advertises detail keys, not list keys", () => {
    const line = text(200, "detail");
    expect(line).toContain("[ ]");
    expect(line).toContain("Esc");
    expect(line).toContain("back");
    expect(line).not.toContain("1-6");
    expect(line).not.toContain("inspect");
  });

  test("an explicit context overrides the model-derived one", () => {
    expect(text(200, "containers", "detail")).toContain("[ ]");
    expect(text(200, "detail", "base")).toContain("1-6");
  });

  test("a narrow detail footer still fits and keeps quit", () => {
    const layout = computeLayout({ cols: 40, rows: 12, visible: ALL, focused: "containers" });
    const line = buildFooter(layout, model("detail"), PLAIN);
    expect(visibleWidth(line)).toBe(40);
    expect(stripAnsi(line)).toContain("q");
  });

  test("errors still render right-aligned in the detail context", () => {
    const layout = computeLayout({ cols: 80, rows: 24, visible: ALL, focused: "containers" });
    const line = buildFooter(layout, { ...model("detail"), error: "connection refused" }, PLAIN);
    expect(visibleWidth(line)).toBe(80);
    expect(stripAnsi(line)).toContain("connection refused");
    expect(stripAnsi(line)).toContain("[ ]");
  });

  test("every hinted key in every context exists in KEYMAP (no drift)", () => {
    for (const focus of ["containers", "detail"] as const) {
      const line = text(200, focus);
      for (const entry of KEYMAP) {
        void entry;
      }
      // The overlay renders one row per KEYMAP entry; the footer may only
      // show keys the overlay also documents.
      const shown = ["1-6", "Tab", "↑↓jk", "Enter", "[ ]", "Esc", "z", "?", "q", "Space", "/"].filter(
        (k) => line.includes(k),
      );
      const known = new Set(KEYMAP.map((k) => k.key));
      for (const key of shown) expect(known.has(key)).toBe(true);
      expect(shown.length).toBeGreaterThan(0);
    }
  });
});

describe("footer filter context", () => {
  test("while filtering, Esc/Enter are advertised and q/? are not", () => {
    const line = text(200, "containers", "filter");
    expect(line).toContain("Esc");
    expect(line).toContain("clear");
    expect(line).toContain("Enter");
    expect(line).toContain("keep");
    // Both type characters in this mode; advertising them would lie.
    expect(line).not.toContain("quit");
    expect(line).not.toContain("?");
  });

  test("a narrow filter footer still fits", () => {
    const layout = computeLayout({ cols: 40, rows: 12, visible: ALL, focused: "containers" });
    const line = buildFooter(layout, model("containers"), { ...PLAIN, context: "filter" });
    expect(visibleWidth(line)).toBe(40);
  });

  test("filter keys exist in KEYMAP (no drift)", () => {
    const line = text(200, "containers", "filter");
    const known = new Set(KEYMAP.map((k) => k.key));
    for (const key of ["Esc", "Enter"]) {
      expect(line).toContain(key);
      expect(known.has(key)).toBe(true);
    }
  });
});
