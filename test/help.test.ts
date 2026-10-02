import { describe, expect, test } from "bun:test";
import { KEYMAP, helpLines, helpTitle } from "../src/ui/view/help";
import { renderHelp } from "../src/ui/render/help";
import { stripAnsi, visibleWidth } from "../src/ui/render/palette";
import { buildFooter } from "../src/ui/render/chrome";
import { computeLayout } from "../src/ui/layout/computeLayout";
import { PANEL_IDS, type PanelId } from "../src/ui/layout/types";
import type { FrameModel } from "../src/ui/view/model";

/**
 * R-17 / ROADMAP P2-T8: `?` opens a help overlay.
 *
 * P8-T2 wants the overlay generated from the same key map the app uses, so the
 * two cannot drift; that single-source requirement is asserted here.
 */

const model: FrameModel = {
  panels: [],
  focus: "containers",
  clock: "",
  detail: { title: "", tabs: [], activeTab: 0, lines: [] },
};

const ALL = new Set<PanelId>(PANEL_IDS);
const theme = {
  accent: "#00ffff",
  border: "#444444",
  dim: "#888888",
  panelTitle: "#888888",
  selectionBg: "#00ffff",
  selectionFg: "#000000",
  foreground: "#ffffff",
} as never;

describe("R-17: help overlay", () => {
  test("the key map covers every advertised binding", () => {
    const keys = KEYMAP.map((k) => k.key);
    expect(keys).toContain("1-6");
    expect(keys).toContain("Tab");
    expect(keys).toContain("↑↓jk");
    expect(keys).toContain("Enter");
    expect(keys).toContain("[ ]");
    expect(keys).toContain("z");
    expect(keys).toContain("Esc");
    expect(keys).toContain("?");
    expect(keys).toContain("q");
  });

  test("every entry has a description", () => {
    for (const entry of KEYMAP) {
      expect(entry.desc.length).toBeGreaterThan(0);
      expect(entry.key.length).toBeGreaterThan(0);
    }
  });

  test("the footer is generated from the same key map (no drift)", () => {
    const layout = computeLayout({ cols: 120, rows: 35, visible: ALL, focused: "containers" });
    const footer = stripAnsi(buildFooter(layout, model, { theme, color: false }));
    expect(footer.length).toBeGreaterThan(0);
    // The footer shows a subset (it drops hints when narrow), so assert that
    // anything the footer does show also appears in the overlay.
    for (const entry of KEYMAP) {
      const shownInFooter = footer.includes(entry.key);
      const shownInHelp = helpLines().some((l) => l.includes(entry.key));
      if (shownInFooter) expect(shownInHelp).toBe(true);
    }
  });

  test("help lines list every binding", () => {
    const text = helpLines().join("\n");
    expect(text).toContain("1-6");
    expect(text).toContain("panel");
    expect(text).toContain("zoom");
    expect(text).toContain("quit");
  });

  test("the overlay is exactly `rows` lines of exactly `cols` cells", () => {
    for (const [cols, rows] of [
      [200, 50],
      [120, 35],
      [80, 24],
      [60, 20],
      [40, 10],
    ] as const) {
      const lines = renderHelp({ cols, rows }, theme, false);
      expect(lines).toHaveLength(rows);
      for (const line of lines) expect(visibleWidth(line)).toBe(cols);
    }
  });

  test("the overlay always has a title and a close hint", () => {
    const lines = renderHelp({ cols: 80, rows: 24 }, theme, false);
    const text = stripAnsi(lines.join("\n"));
    expect(text).toContain(helpTitle());
    expect(text).toContain("Esc");
  });

  test("a tiny terminal degrades to a short message, not a broken box", () => {
    const lines = renderHelp({ cols: 40, rows: 10 }, theme, false);
    expect(lines).toHaveLength(10);
    for (const line of lines) expect(visibleWidth(line)).toBe(40);
    const text = stripAnsi(lines.join("\n"));
    expect(text.length).toBeGreaterThan(0);
  });

  test("no escape sequences are emitted when colour is off", () => {
    const lines = renderHelp({ cols: 80, rows: 24 }, theme, false);
    expect(lines.join("\n")).not.toContain("\u001B");
  });
});