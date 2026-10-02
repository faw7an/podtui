import { describe, expect, test } from "bun:test";
import { renderFrame } from "../src/ui/render/frame";
import { renderPanel, scrollHint, windowRows } from "../src/ui/render/panelLines";
import { renderDetail } from "../src/ui/render/detailLines";
import { buildFooter, buildHeader } from "../src/ui/render/chrome";
import { LineBuffer, composeInline } from "../src/ui/render/compose";
import { stripAnsi, visibleWidth } from "../src/ui/render/palette";
import { computeLayout } from "../src/ui/layout/computeLayout";
import { PANEL_IDS, type PanelId } from "../src/ui/layout/types";
import {
  COLUMN_HEADERS,
  PANEL_COLUMNS,
  panelMeta,
  type FrameModel,
  type PanelModel,
  type RowModel,
} from "../src/ui/view/model";
import { defaultTheme } from "../src/theme/theme";

const COLORS = { theme: defaultTheme, color: true };
const PLAIN = { theme: defaultTheme, color: false, focused: true };
/** renderPanel reads focus from opts, so tests must pass it there. */
const focusedColor = { theme: defaultTheme, color: true, focused: true };

function row(id: string, name: string, state = "● running", extra: Record<string, string> = {}): RowModel {
  return { id, tone: "ok", cells: { name, state, ...extra } };
}

function panel(
  id: PanelId,
  items: RowModel[],
  selected = 0,
): PanelModel {
  const meta = panelMeta(id);
  return { id, ...meta, columns: PANEL_COLUMNS[id], items, selected };
}

const items = (n: number): RowModel[] =>
  Array.from({ length: n }, (_, i) => row(`i${i}`, `container-number-${i}`, "● running", { age: "2h", image: "nginx:alpine", size: "64.3MB", count: "3", mountpoint: "/var/lib/x" }));

function model(_panelCount = 6, rows = 6): FrameModel {
  return {
    panels: PANEL_IDS.map((id) => panel(id, items(rows))),
    focus: "containers",
    clock: "9:40 PM",
    detail: {
      title: "container-number-0 · running",
      tabs: ["Logs", "Stats", "Env", "Config", "Top"],
      activeTab: 0,
      lines: ["line one", "line two", "line three"],
    },
  };
}

const ALL = new Set<PanelId>(PANEL_IDS);

// --------------------------------------------------------------- windowRows

describe("windowRows", () => {
  test("keeps the selection visible at every position", () => {
    const list = items(100);
    for (let sel = 0; sel < 100; sel++) {
      const w = windowRows(list, sel, 5);
      expect(w.rows.length).toBe(5);
      expect(sel).toBeGreaterThanOrEqual(w.offset);
      expect(sel).toBeLessThan(w.offset + 5);
    }
  });

  test("reports what is hidden above and below", () => {
    const list = items(100);
    const w = windowRows(list, 50, 5);
    expect(w.above + w.rows.length + w.below).toBe(100);
    expect(w.above).toBeGreaterThan(0);
    expect(w.below).toBeGreaterThan(0);
  });

  test("no hint when everything fits", () => {
    const w = windowRows(items(3), 1, 5);
    expect(scrollHint(w.above, w.below)).toBe("");
  });

  test("degrades safely at zero rows", () => {
    expect(windowRows(items(5), 2, 0).rows).toHaveLength(0);
  });
});

// --------------------------------------------------------------- LineBuffer

describe("LineBuffer", () => {
  test("always produces exactly rows lines of exactly cols cells", () => {
    const b = new LineBuffer(40, 5);
    b.write(0, 0, "hello");
    b.write(10, 2, "world");
    const lines = b.toLines();
    expect(lines).toHaveLength(5);
    for (const l of lines) expect(visibleWidth(l)).toBe(40);
  });

  test("truncates a write that would overflow the row", () => {
    const b = new LineBuffer(10, 1);
    b.write(0, 0, "x".repeat(50));
    expect(visibleWidth(b.toLines()[0] ?? "")).toBe(10);
  });

  test("ignores writes outside the buffer", () => {
    const b = new LineBuffer(10, 2);
    expect(b.write(0, 5, "nope")).toBe(0);
    expect(b.write(-1, 0, "nope")).toBe(0);
    expect(b.write(20, 0, "nope")).toBe(0);
  });

  test("reports the width it actually wrote", () => {
    const b = new LineBuffer(20, 1);
    expect(b.write(0, 0, "abc")).toBe(3);
    expect(b.write(0, 0, "abcdef")).toBe(6);
  });

  test("does not overwrite an occupied cell", () => {
    const b = new LineBuffer(10, 1);
    b.write(0, 0, "abcdef");
    b.write(3, 0, "ZZ");
    expect(b.toLines()[0]).toContain("abcdef");
  });

  test("composeInline pads to exactly the width", () => {
    expect(visibleWidth(composeInline(["ab", "cd"], 8))).toBe(8);
    expect(visibleWidth(composeInline(["a".repeat(50)], 5))).toBe(5);
  });
});

// ----------------------------------------------------------------- renderPanel

describe("renderPanel (LAYOUT_SPEC §6)", () => {
  const rect = (h: number, w = 30, id: PanelId = "containers", focused = true) => ({
    id,
    x: 0,
    y: 0,
    w,
    h,
    collapsed: h < 4,
    showHeader: h >= 6,
    focused,
  });

  test("always emits exactly h lines of exactly w cells", () => {
    for (const h of [1, 2, 3, 4, 5, 6, 7, 12, 30]) {
      for (const w of [12, 20, 30, 55]) {
        const lines = renderPanel(rect(h, w), panel("containers", items(8)), PLAIN);
        expect(lines).toHaveLength(h);
        for (const l of lines) expect(visibleWidth(l)).toBe(w);
      }
    }
  });

  test("h >= 6 draws a column header and STATUS stays on one line", () => {
    const lines = renderPanel(rect(8, 30), panel("containers", items(4)), PLAIN);
    expect(lines[1]).toContain("NAME");
    expect(lines[1]).toContain("STATUS");
    // The original bug rendered this as S T A T U S across 6 rows.
    expect(stripAnsi(lines[1] ?? "")).toContain("STATUS");
  });

  test("h 4-5 drops the column header and shows data rows instead", () => {
    const short = items(4).map((r) => ({ ...r, cells: { ...r.cells, name: r.cells["name"]?.slice(0, 8) ?? "" } }));
    const five = renderPanel(rect(5, 30), panel("containers", short), PLAIN);
    expect(five).toHaveLength(5);
    expect(stripAnsi(five[1] ?? "")).not.toContain("NAME");
    expect(stripAnsi(five[1] ?? "")).toContain("containe");

    const four = renderPanel(rect(4, 30), panel("containers", short), PLAIN);
    expect(four).toHaveLength(4);
    expect(stripAnsi(four[1] ?? "")).not.toContain("NAME");
    expect(stripAnsi(four[1] ?? "")).toContain("containe");
  });

  test("h < 4 is a borderless title strip with the marker", () => {
    for (const h of [1, 2, 3]) {
      const lines = renderPanel(rect(h, 30), panel("images", items(2)), PLAIN);
      expect(lines).toHaveLength(h);
      const first = stripAnsi(lines[0] ?? "");
      expect(first).toContain("▸ 3 Images (2)");
      expect(lines).toHaveLength(h);
      expect(first).not.toContain("│");
      expect(first).not.toContain("╭");
    }
  });

  test("an unfocused collapsed strip uses a dim marker and no inverse", () => {
    const focused = renderPanel(rect(1, 30, "images", true), panel("images", items(2)), focusedColor);
    const blurred = renderPanel(rect(1, 30, "images", false), panel("images", items(2)), { ...COLORS, focused: false });
    // The marker is on the strip in both cases; only focus adds bold+accent.
    expect(stripAnsi(focused[0] ?? "")).toContain("▸ 3 Images (2)");
    expect(stripAnsi(blurred[0] ?? "")).toContain("▸ 3 Images (2)");
    expect(focused[0]).toContain("\u001B[1m");
    expect(blurred[0]).toContain("\u001B[2m");
    expect(blurred[0]).not.toContain("\u001B[1m");
  });

  test("focused selection uses reverse video; unfocused does not", () => {
    const focused = renderPanel(rect(8, 60, "containers", true), panel("containers", items(3), 1), focusedColor);
    const plain = renderPanel(rect(8, 60, "containers", false), panel("containers", items(3), 1), { ...COLORS, focused: false });
    const focusedText = focused.map(stripAnsi).join("\n");
    const plainText = plain.map(stripAnsi).join("\n");
    // The marker is present in both, so meaning survives without colour.
    expect(focusedText).toContain("▸ container-number-1");
    expect(plainText).toContain("▸ container-number-1");
    // Only the focused panel inverts.
    expect(focused.join("\n")).toContain("\u001B[7m");
    const selectedLine = plain.find((l) => stripAnsi(l).includes("▸ container-number-1")) ?? "";
    expect(selectedLine).not.toContain("\u001B[7m");
  });

  test("an unfocused panel keeps its remembered selection after focus moves", () => {
    const p = panel("images", items(4), 3);
    const lines = renderPanel(rect(8, 60, "images", false), p, PLAIN);
    expect(stripAnsi(lines.join("\n"))).toContain("▸ container-number-3");
  });

  test("status always has a glyph, never colour alone", () => {
    const lines = renderPanel(rect(8, 30), panel("containers", items(2)), PLAIN);
    const text = stripAnsi(lines.join("\n"));
    expect(text).toContain("● running");
  });

  test("scroll hint sits in the bottom border, not in a data row", () => {
    const lines = renderPanel(rect(8, 30), panel("containers", items(50), 25), PLAIN);
    const bottom = stripAnsi(lines[7] ?? "");
    expect(bottom).toContain("more");
    expect(bottom).toContain("↓");
    // Still exactly 8 lines: the hint cost nothing.
    expect(lines).toHaveLength(8);
  });

  test("low-priority columns drop instead of squeezing", () => {
    const wide = stripAnsi(renderPanel(rect(8, 60), panel("containers", items(2)), PLAIN)[1] ?? "");
    expect(wide).toContain("IMAGE");
    expect(wide).toContain("AGE");
    // Drop order is by ascending priority: AGE, then IMAGE, then STATUS.
    const mid = stripAnsi(renderPanel(rect(8, 30), panel("containers", items(2)), PLAIN)[1] ?? "");
    expect(mid).toContain("NAME");
    expect(mid).toContain("STATUS");
    expect(mid).not.toContain("AGE");
    expect(mid).not.toContain("IMAGE");
    // Too narrow for NAME + STATUS together: only NAME survives.
    const narrow = stripAnsi(renderPanel(rect(8, 20), panel("containers", items(2)), PLAIN)[1] ?? "");
    expect(narrow).toContain("NAME");
    expect(narrow).not.toContain("STATUS");
    expect(narrow).not.toContain("AGE");
  });

  test("an empty panel names its count in the title", () => {
    const lines = renderPanel(rect(8, 30), panel("quadlets", []), PLAIN);
    expect(stripAnsi(lines[0] ?? "")).toContain("[6] Quadlets 0");
    expect(stripAnsi(lines.join("\n"))).toContain("(empty)");
  });

  test("a panel with no data source shows its placeholder, not a bare box", () => {
    // Quadlets is Phase 6; it must read as a deliberate placeholder.
    const p = { ...panel("quadlets", []), emptyLabel: "not implemented yet (phase 6)" };
    const text = stripAnsi(renderPanel(rect(8, 40), p, PLAIN).join("\n"));
    expect(text).toContain("not implemented yet (phase 6)");
    expect(text).not.toContain("(empty)");
  });

  test("the placeholder is truncated, never wrapped, in a narrow panel", () => {
    const p = { ...panel("quadlets", []), emptyLabel: "not implemented yet (phase 6)" };
    for (const w of [12, 16, 20, 26, 40]) {
      const lines = renderPanel(rect(6, w), p, PLAIN);
      expect(lines).toHaveLength(6);
      for (const l of lines) expect(visibleWidth(l)).toBe(w);
      // Narrow panels truncate the label rather than wrapping it onto a
      // second row, which is the bug this whole layer exists to prevent.
      const text = stripAnsi(lines.join("\n"));
      expect(text).toContain("not");
      if (w >= 26) expect(text).toContain("not implemented");
      // Exactly one row carries the label; a wrapped label would need two.
      expect(lines.filter((l) => stripAnsi(l).includes("not"))).toHaveLength(1);
    }
  });

  test("quadlets keeps its placeholder only while it has no rows", () => {
    const withRows = { ...panel("quadlets", items(2)), emptyLabel: "not implemented yet (phase 6)" };
    const text = stripAnsi(renderPanel(rect(8, 40), withRows, PLAIN).join("\n"));
    expect(text).not.toContain("not implemented");
    expect(text).toContain("container-number-0");
  });

  test("every column header is defined for every column id in use", () => {
    for (const id of PANEL_IDS) {
      for (const col of PANEL_COLUMNS[id]) {
        expect(COLUMN_HEADERS[col.id]).toBeDefined();
      }
    }
  });
});

// ---------------------------------------------------------------- renderDetail

describe("renderDetail (LAYOUT_SPEC §7)", () => {
  const m = model();
  test("always emits exactly h lines of exactly w cells", () => {
    for (const [h, w] of [[3, 20], [10, 40], [30, 90], [48, 110]] as const) {
      const lines = renderDetail({ x: 0, y: 0, w, h }, m.detail, PLAIN);
      expect(lines).toHaveLength(h);
      for (const l of lines) expect(visibleWidth(l)).toBe(w);
    }
  });

  test("has a one-row internal tab strip", () => {
    const lines = renderDetail({ x: 0, y: 0, w: 40, h: 10 }, m.detail, PLAIN);
    expect(stripAnsi(lines[1] ?? "")).toContain("Logs");
    expect(stripAnsi(lines[1] ?? "")).toContain("Top");
  });

  test("truncates long lines with an ellipsis instead of wrapping", () => {
    const long = "x".repeat(200);
    const lines = renderDetail(
      { x: 0, y: 0, w: 30, h: 8 },
      { ...m.detail, lines: [long] },
      PLAIN,
    );
    expect(lines).toHaveLength(8);
    expect(stripAnsi(lines[2] ?? "")).toContain("…");
  });
});

// ------------------------------------------------------------ header / footer

describe("header and footer (LAYOUT_SPEC §3)", () => {
  test("header is exactly cols wide and shows all six numbers", () => {
    for (const cols of [40, 60, 80, 100, 120, 200]) {
      const layout = computeLayout({ cols, rows: 24, visible: ALL, focused: "containers" });
      const line = buildHeader(layout, model(), PLAIN);
      expect(visibleWidth(line)).toBe(cols);
      const text = stripAnsi(line);
      for (const id of PANEL_IDS) {
        expect(text).toContain(String(panelMeta(id).number));
      }
    }
  });

  test("header degrades to numbers only when narrow", () => {
    const narrow = computeLayout({ cols: 60, rows: 24, visible: ALL, focused: "containers" });
    const text = stripAnsi(buildHeader(narrow, model(), PLAIN));
    expect(text).not.toContain("Containers");
    expect(text).toContain("2");
  });

  test("hidden panels keep a dim tab so they can be toggled back", () => {
    const layout = computeLayout({
      cols: 200,
      rows: 50,
      visible: new Set<PanelId>(["containers"]),
      focused: "containers",
    });
    const line = buildHeader(layout, model(), COLORS);
    expect(stripAnsi(line)).toContain("1");
    // Dimmed entries carry the SGR dim code.
    expect(line).toContain("\u001B[2m");
  });

  test("footer is exactly cols wide and always offers quit", () => {
    for (const cols of [40, 60, 80, 200]) {
      const layout = computeLayout({ cols, rows: 24, visible: ALL, focused: "containers" });
      const line = buildFooter(layout, model(), PLAIN);
      expect(visibleWidth(line)).toBe(cols);
      expect(stripAnsi(line)).toContain("q");
    }
  });

  test("footer drops hints by priority and never overflows", () => {
    const narrow = computeLayout({ cols: 40, rows: 12, visible: ALL, focused: "containers" });
    const text = stripAnsi(buildFooter(narrow, model(), PLAIN));
    expect(text).toContain("quit");
    expect(text).not.toContain("inspect");
  });

  test("footer shows an error without exceeding the row", () => {
    const layout = computeLayout({ cols: 50, rows: 12, visible: ALL, focused: "containers" });
    const line = buildFooter(layout, { ...model(), error: "connection refused" }, PLAIN);
    expect(visibleWidth(line)).toBe(50);
    expect(stripAnsi(line)).toContain("connection refused");
  });
});

// ------------------------------------------------------------------ renderFrame

describe("renderFrame: LAYOUT_SPEC §9 invariants", () => {
  const SIZES = [
    [200, 50],
    [150, 40],
    [120, 35],
    [110, 24],
    [100, 30],
    [80, 24],
    [70, 30],
    [60, 20],
    [40, 10],
  ] as const;

  for (const [cols, rows] of SIZES) {
    for (const color of [true, false]) {
      test(`${cols}x${rows} -> exactly ${rows} lines of exactly ${cols} cells`, () => {
        const layout = computeLayout({
          cols,
          rows,
          visible: ALL,
          focused: "containers",
        });
        const lines = renderFrame(layout, model(6, 12), { theme: defaultTheme, color });
        expect(lines).toHaveLength(rows);
        for (const line of lines) {
          expect(visibleWidth(line)).toBe(cols);
          // Invariant 4: never more than `cols`.
          expect(displayWidthRaw(line)).toBeLessThanOrEqual(cols);
        }
      });
    }
  }

  test("property sweep across the whole size matrix", () => {
    for (let cols = 40; cols <= 200; cols += 1) {
      for (let rows = 10; rows <= 60; rows += 1) {
        const layout = computeLayout({
          cols,
          rows,
          visible: ALL,
          focused: "containers",
        });
        const lines = renderFrame(layout, model(6, 20), PLAIN);
        expect(lines).toHaveLength(rows);
        for (const line of lines) expect(visibleWidth(line)).toBe(cols);
      }
    }
  });

  test("every visible panel appears in the output", () => {
    const layout = computeLayout({
      cols: 200,
      rows: 50,
      visible: ALL,
      focused: "containers",
    });
    const text = stripAnsi(renderFrame(layout, model(6, 3), PLAIN).join("\n"));
    for (const id of PANEL_IDS) {
      expect(text).toContain(`[${panelMeta(id).number}] ${panelMeta(id).title}`);
    }
  });

  test("zooming hides the other panels", () => {
    const layout = computeLayout({
      cols: 120,
      rows: 35,
      visible: ALL,
      focused: "containers",
      zoom: "containers",
    });
    const text = stripAnsi(renderFrame(layout, model(), PLAIN).join("\n"));
    expect(text).toContain("[2] Containers");
    expect(text).not.toContain("[1] Pods");
  });

  test("mode S Enter shows detail full-screen", () => {
    const layout = computeLayout({
      cols: 60,
      rows: 20,
      visible: ALL,
      focused: "detail",
      detailFullscreen: true,
    });
    const text = stripAnsi(renderFrame(layout, model(), PLAIN).join("\n"));
    expect(text).toContain("Logs");
    expect(text).not.toContain("[2] Containers");
  });

  test("TOO_SMALL draws only the message", () => {
    const layout = computeLayout({ cols: 30, rows: 8, visible: ALL, focused: "containers" });
    const lines = renderFrame(layout, model(), PLAIN);
    expect(lines).toHaveLength(8);
    const text = stripAnsi(lines.join("\n"));
    expect(text).toContain("Terminal too small");
    expect(text).not.toContain("Containers");
  });

  test("a hidden panel is not drawn", () => {
    const layout = computeLayout({
      cols: 200,
      rows: 50,
      visible: new Set<PanelId>(["containers", "images"]),
      focused: "containers",
    });
    const text = stripAnsi(renderFrame(layout, model(6, 6), PLAIN).join("\n"));
    expect(text).toContain("[2] Containers");
    expect(text).not.toContain("[1] Pods");
    // But the header still lists it, so it can be toggled back.
    expect(text).toMatch(/1\s+Pods|Pods/);
  });

  test("NO_COLOR output contains no escape sequences at all", () => {
    const layout = computeLayout({
      cols: 120,
      rows: 35,
      visible: ALL,
      focused: "containers",
    });
    const lines = renderFrame(layout, model(6, 8), PLAIN);
    expect(lines.join("\n")).not.toContain("\u001B");
  });
});

function displayWidthRaw(text: string): number {
  // Raw byte length including escapes is always >= visible width; use the
  // stripped value so this is the true cell count.
  return visibleWidth(text);
}
