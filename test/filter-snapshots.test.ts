import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { computeLayout } from "../src/ui/layout/computeLayout.ts";
import { renderFrame } from "../src/ui/render/frame.ts";
import { buildFrameModel, EMPTY_DATA } from "../src/ui/view/build.ts";
import { PANEL_IDS, type PanelId } from "../src/ui/layout/types.ts";
import { defaultTheme } from "../src/theme/theme.ts";
import { visibleWidth } from "../src/ui/render/palette.ts";
import type { ContainerListItem } from "../src/api/types.ts";

/**
 * Filter snapshots: full frames with the popup open (5 canonical sizes), one
 * kept-filter frame and one zero-match frame, committed as literal files under
 * test/__snapshots__/filter/.
 *
 * Literal files compared with toBe — not toMatchSnapshot — so diffs stay
 * reviewable and the layout is explicit. Regenerate with UPDATE_SNAPSHOTS=1
 * after eyeballing the new output, never blindly. Data comes from the real
 * recorded fixture, so the snapshots exercise the true pipeline.
 *
 * Rendered through renderFrame (pure) rather than Ink: Screen adds nothing but
 * size detection, and Ink's own printing is covered by frame-ink.test.tsx.
 */

const SNAP_DIR = path.join(import.meta.dirname, "__snapshots__", "filter");
const FIXTURE = path.join(import.meta.dirname, "fixtures", "containers-list.json");

function noSelection(): Record<PanelId, string> {
  return Object.fromEntries(PANEL_IDS.map((id) => [id, ""])) as Record<PanelId, string>;
}

function frame(options: {
  cols: number;
  rows: number;
  query?: string;
  popup?: boolean;
  focus?: PanelId | "detail";
}): string[] {
  const containers = JSON.parse(fs.readFileSync(FIXTURE, "utf-8")) as ContainerListItem[];
  const selected = { ...noSelection(), containers: containers[0]?.Id ?? "" };
  const model = buildFrameModel({
    data: { ...EMPTY_DATA, containers },
    selected,
    focus: options.focus ?? "containers",
    now: 0,
    clock: "",
    filter: (options.query !== undefined ? { containers: options.query } : undefined) as never,
  });
  const layout = computeLayout({
    cols: options.cols,
    rows: options.rows,
    visible: new Set<PanelId>(PANEL_IDS),
    focused: options.focus ?? "containers",
  });
  return renderFrame(layout, model, {
    theme: defaultTheme,
    color: false,
    hintContext:
      options.query !== undefined && !options.popup
        ? ("filterKept" as const)
        : options.popup
          ? ("filter" as const)
          : undefined,
    filterPopup: options.popup ? "containers" : null,
  });
}

function check(name: string, lines: string[], cols: number, rows: number): void {
  expect(lines).toHaveLength(rows);
  for (const line of lines) expect(visibleWidth(line)).toBe(cols);
  const text = lines.join("\n");
  if (process.env["UPDATE_SNAPSHOTS"] === "1") {
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    fs.writeFileSync(path.join(SNAP_DIR, name), text + "\n");
    return;
  }
  // Strip exactly one trailing newline: trimEnd would also eat the footer
  // row's padding, which is significant (every line is exactly `cols` wide).
  expect(text).toBe(fs.readFileSync(path.join(SNAP_DIR, name), "utf-8").replace(/\n$/, ""));
}

describe("filter snapshots", () => {
  test("popup open at canonical sizes", () => {
    for (const [cols, rows] of [
      [200, 50],
      [120, 35],
      [80, 24],
      [60, 20],
      [40, 10],
    ] as const) {
      const lines = frame({ cols, rows, query: "web", popup: true });
      check(`${cols}x${rows}.txt`, lines, cols, rows);
      expect(lines.join("\n")).toContain("Filter:");
    }
  });

  test("kept filter without popup", () => {
    const lines = frame({ cols: 80, rows: 24, query: "web" });
    check("kept-80x24.txt", lines, 80, 24);
    expect(lines.join("\n")).toContain("clear filter");
  });

  test("zero matches", () => {
    // Popup closed: the panel body itself names the query and the way out.
    // (With the popup open the same state shows 0/7 inside the popup instead.)
    const lines = frame({ cols: 80, rows: 24, query: "zzz" });
    check("zero-80x24.txt", lines, 80, 24);
    expect(lines.join("\n")).toContain("No matches for 'zzz'");
  });
});
