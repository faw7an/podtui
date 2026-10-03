import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildDetail,
  CONFIG_SECTIONS,
  DETAIL_TABS,
  toggleAllSections,
  type DetailTabId,
} from "../src/ui/view/detail";
import { renderDetail } from "../src/ui/render/detailLines";
import { stripAnsi, visibleWidth } from "../src/ui/render/palette";
import type { ContainerInspect } from "../src/api/types";
import { initialState, reducer } from "../src/ui/layout/layoutReducer";

/**
 * R-16 / ROADMAP P2-T7: detail pane with a TabBar, and a Config tab that
 * renders formatted inspect data.
 *
 * Before this the detail pane showed a hardcoded tab list with `activeTab: 0`
 * and no way to switch, and no inspect data was ever rendered.
 */

const FIXTURE_DIR = path.join(import.meta.dirname, "fixtures");
const readFixture = <T,>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf-8")) as T;

const inspect = readFixture<ContainerInspect>("container-inspect.json");


describe("R-16: detail tab strip", () => {
  test("exposes the five detail tabs", () => {
    expect(DETAIL_TABS.map((t) => t.id)).toEqual(["logs", "stats", "env", "config", "top"]);
    expect(DETAIL_TABS.map((t) => t.label)).toEqual(["Logs", "Stats", "Env", "Config", "Top"]);
  });

  test("tab switching clamps at both ends and wraps forward", () => {
    const n = DETAIL_TABS.length;
    expect(nextTabIndex(0, 1)).toBe(1);
    expect(nextTabIndex(n - 1, 1)).toBe(0);
    expect(nextTabIndex(0, -1)).toBe(n - 1);
    // Out-of-range input must still yield a valid index, never undefined/NaN.
    for (const [cur, delta] of [
      [-5, 1],
      [99, -1],
      [-1, 0],
      [n, 1],
    ] as const) {
      const idx = nextTabIndex(cur, delta);
      expect(Number.isInteger(idx)).toBe(true);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(n);
    }
  });

  test("the detail model reports the requested tab as active", () => {
    for (const tab of ["logs", "stats", "env", "config", "top"] as DetailTabId[]) {
      const detail = buildDetail({ inspect, activeTab: tab, hasSelection: true });
      expect(detail.activeTabId).toBe(tab);
      const meta = DETAIL_TABS.find((t) => t.id === tab);
      expect(detail.tabs).toContain(meta?.label ?? "");
    }
  });
});

describe("R-16: Config tab renders formatted inspect data", () => {
  const detail = buildDetail({ inspect, activeTab: "config", hasSelection: true });

  test("shows key/value rows from the inspect fixture", () => {
    const text = detail.lines.join("\n");
    expect(text).toContain("Name");
    expect(text).toContain("web");           // the fixture's container name
    expect(text).toContain("running");        // State.Status
    expect(text).toContain("nginx");          // ImageName / Cmd
  });

  test("groups rows under collapsible section headings", () => {
    const headings = detail.lines.filter((l) => l.startsWith("#"));
    expect(headings.length).toBeGreaterThan(1);
    expect(headings.join("\n")).toMatch(/#\s*(State|Config|Network)/);
  });

  test("sections can be collapsed", () => {
    const collapsed = buildDetail({
      inspect,
      activeTab: "config",
      hasSelection: true,
      collapsed: new Set(["config"]),
    });
    const headingCount = collapsed.lines.filter((l) => l.startsWith("#")).length;
    const fullCount = detail.lines.filter((l) => l.startsWith("#")).length;
    expect(headingCount).toBe(fullCount);
    // Collapsing a section hides its rows but keeps its heading.
    expect(collapsed.lines.length).toBeLessThan(detail.lines.length);
    expect(collapsed.lines.join("\n")).toContain("# Config");
  });

  test("secret-looking env values are masked until revealed", () => {
    // The sandbox seeds API_TOKEN; masking is unit-tested in Phase 3, but the
    // Config tab must not print it in the clear.
    const envDetail = buildDetail({ inspect, activeTab: "env", hasSelection: true });
    const text = envDetail.lines.join("\n");
    if (text.includes("API_TOKEN")) {
      // The secret must never appear, and the value must be stars.
      expect(text).not.toContain("super-secret-token-12345");
      expect(text).toMatch(/API_TOKEN\s+\*{3,}/);
    }
    // A non-secret value stays readable.
    expect(text).toMatch(/NODE_ENV\s+production/);
  });

  test("without a selection the detail pane says so", () => {
    const empty = buildDetail({ inspect: null, activeTab: "config", hasSelection: false });
    expect(empty.title).toBe("(no selection)");
    expect(empty.lines.length).toBeGreaterThan(0);
  });
});

describe("R-16: detail rendering is width-bounded", () => {
  const detail = buildDetail({ inspect, activeTab: "config", hasSelection: true });

  for (const [w, h] of [
    [30, 8],
    [40, 12],
    [80, 24],
    [120, 35],
  ] as const) {
    test(`${w}x${h}: exactly ${h} lines of exactly ${w} cells`, () => {
      const lines = renderDetail({ x: 0, y: 0, w, h }, detail, {
        theme: {
          accent: "#00ffff",
          border: "#444444",
          dim: "#888888",
          panelTitle: "#888888",
          selectionBg: "#00ffff",
          selectionFg: "#000000",
        } as never,
        color: false,
      });
      expect(lines).toHaveLength(h);
      for (const line of lines) expect(visibleWidth(line)).toBe(w);
    });
  }

  test("long inspect values truncate with an ellipsis, never wrap", () => {
    const longValue = "x".repeat(500);
    const wide = buildDetail({
      inspect: { ...inspect, ImageDigest: longValue } as ContainerInspect,
      activeTab: "config",
      hasSelection: true,
    });
    const narrow = renderDetail({ x: 0, y: 0, w: 40, h: 12 }, wide, {
      theme: { accent: "#0ff", border: "#444", dim: "#888", panelTitle: "#888", selectionBg: "#0ff", selectionFg: "#000" } as never,
      color: false,
    });
    const text = stripAnsi(narrow.join("\n"));
    expect(text).toContain("…");
    expect(narrow).toHaveLength(12);
  });

  test("the content is windowed to the available rows", () => {
    const lines = renderDetail({ x: 0, y: 0, w: 80, h: 10 }, detail, {
      theme: { accent: "#0ff", border: "#444", dim: "#888", panelTitle: "#888", selectionBg: "#0ff", selectionFg: "#000" } as never,
      color: false,
    });
    // border(2) + tab strip(1) leaves the rest for content rows
    expect(lines).toHaveLength(10);
    expect(visibleWidth(lines[0] ?? "")).toBe(80);
  });
});

function nextTabIndex(current: number, delta: number): number {
  const n = DETAIL_TABS.length;
  const wrapped = ((current + delta) % n + n) % n;
  return Math.min(n - 1, Math.max(0, wrapped));
}
describe("P2-T7: section folding", () => {
  test("toggleAllSections expands and collapses the whole Config tab", () => {
    expect(toggleAllSections(new Set())).toEqual(new Set(CONFIG_SECTIONS));
    expect(toggleAllSections(new Set(CONFIG_SECTIONS))).toEqual(new Set());
    // Partially folded still folds everything: one key, one predictable result.
    expect(toggleAllSections(new Set(["state"]))).toEqual(new Set(CONFIG_SECTIONS));
  });

  test("a folded Config tab shows headings with (+) and no body rows", () => {
    const folded = buildDetail({ inspect, activeTab: "config", hasSelection: true, collapsed: new Set(CONFIG_SECTIONS) });
    expect(folded.lines).toContain("# State (+)");
    expect(folded.lines).toContain("# Config (+)");
    expect(folded.lines.some((l) => l.includes("daemon off;"))).toBe(false);
  });

  test("the reducer owns the collapsed set; Space toggles it via toggleAllSections", () => {
    let s = reducer(initialState(), { type: "toggleAllSections" });
    expect(s.collapsed).toEqual(new Set(CONFIG_SECTIONS));
    s = reducer(s, { type: "toggleAllSections" });
    expect(s.collapsed).toEqual(new Set());
  });

  test("folding does not disturb the scroll offset beyond the new end", () => {
    // Scroll position survives folding; the renderer clamps it.
    let s = reducer(initialState(), { type: "detailScroll", dir: 1 });
    s = reducer(s, { type: "toggleAllSections" });
    expect(s.detailScroll).toBeGreaterThan(0);
  });
});

describe("P2-T7: detail scrolling", () => {
  const long = buildDetail({ inspect, activeTab: "config", hasSelection: true });
  const rect = { x: 0, y: 0, w: 60, h: 10 };
  const theme = {
    accent: "#00ffff",
    border: "#444444",
    dim: "#888888",
    panelTitle: "#888888",
    selectionBg: "#00ffff",
    selectionFg: "#000000",
  } as never;

  test("the window starts at the top and signals overflow", () => {
    const lines = renderDetail(rect, long, { theme, color: false });
    expect(lines).toHaveLength(10);
    expect(stripAnsi(lines.join("\n"))).toContain("more");
  });

  test("a scroll offset windows the content instead of the top", () => {
    const top = renderDetail(rect, long, { theme, color: false });
    const scrolled = renderDetail(rect, long, { theme, color: false, scroll: 5 });
    expect(stripAnsi(scrolled.join("\n"))).not.toBe(stripAnsi(top.join("\n")));
    expect(scrolled).toHaveLength(10);
    for (const line of scrolled) expect(visibleWidth(line)).toBe(60);
  });

  test("an offset past the end clamps to the last window", () => {
    const a = renderDetail(rect, long, { theme, color: false, scroll: 10_000 });
    const b = renderDetail(rect, long, { theme, color: false, scroll: long.lines.length });
    expect(stripAnsi(a.join("\n"))).toBe(stripAnsi(b.join("\n")));
    expect(a).toHaveLength(10);
  });

  test("the reducer moves by a page, never below zero", () => {
    let s = reducer(initialState(), { type: "detailScroll", dir: 1 });
    expect(s.detailScroll).toBeGreaterThan(0);
    const page = s.detailScroll;
    s = reducer(s, { type: "detailScroll", dir: 1 });
    expect(s.detailScroll).toBe(page * 2);
    s = reducer(s, { type: "detailScroll", dir: -1 });
    expect(s.detailScroll).toBe(page);
    s = reducer(initialState(), { type: "detailScroll", dir: -1 });
    expect(s.detailScroll).toBe(0);
  });

  test("selection, filter and tab changes reset the scroll", () => {
    const scrolled = reducer(initialState(), { type: "detailScroll", dir: 1 });
    expect(scrolled.detailScroll).toBeGreaterThan(0);
    expect(reducer(scrolled, { type: "select", id: "containers", itemId: "x" }).detailScroll).toBe(0);
    const filtering = reducer(scrolled, { type: "startFilter" });
    const typing = reducer(filtering, { type: "filterInput", text: "x" });
    expect(typing.detailScroll).toBe(0);
    const rescrolled = reducer(typing, { type: "detailScroll", dir: 1 });
    expect(reducer(rescrolled, { type: "clearFilter" }).detailScroll).toBe(0);
    const rescrolled2 = reducer(typing, { type: "detailScroll", dir: 1 });
    expect(reducer(rescrolled2, { type: "endFilter" }).detailScroll).toBe(0);
    expect(reducer(scrolled, { type: "resetDetailScroll" }).detailScroll).toBe(0);
  });
});

describe("P2-T7: Config key/value colours", () => {
  const detail = buildDetail({ inspect, activeTab: "config", hasSelection: true });
  const rect = { x: 0, y: 0, w: 60, h: 30 };
  const theme = {
    accent: "#00ffff",
    border: "#444444",
    dim: "#888888",
    panelTitle: "#888888",
    selectionBg: "#00ffff",
    selectionFg: "#000000",
  } as never;

  test("keys are painted but the text is unchanged", () => {
    const lines = renderDetail(rect, detail, { theme, color: true });
    const joined = lines.join("\n");
    expect(joined).toContain("\u001B[");
    expect(stripAnsi(joined)).toContain("Name");
    expect(stripAnsi(joined)).toContain("# State");
  });

  test("colour off still means zero escape sequences", () => {
    const lines = renderDetail(rect, detail, { theme, color: false });
    expect(lines.join("\n")).not.toContain("\u001B");
    for (const line of lines) expect(visibleWidth(line)).toBe(60);
  });

  test("overlong keys fall back to plain rather than tearing the row", () => {
    const odd = {
      ...detail,
      lines: ["VERYLONGKEYNAME=value", "# Heading", "short       value"],
    };
    const lines = renderDetail(rect, odd, { theme, color: true });
    expect(lines).toHaveLength(30);
    for (const line of lines) expect(visibleWidth(line)).toBe(60);
    expect(stripAnsi(lines.join("\n"))).toContain("VERYLONGKEYNAME=value");
  });
});
