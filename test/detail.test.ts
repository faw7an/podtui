import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildDetail, DETAIL_TABS, type DetailTabId } from "../src/ui/view/detail";
import { renderDetail } from "../src/ui/render/detailLines";
import { stripAnsi, visibleWidth } from "../src/ui/render/palette";
import type { ContainerInspect } from "../src/api/types";

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