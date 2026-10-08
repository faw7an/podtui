/**
 * Hit-testing (P7-T7): render a real frame, find where something APPEARS,
 * click there, and check the hit names it — so geometry cannot drift from
 * the renderers. Several sizes, including a resize.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { computeLayout } from "../src/ui/layout/computeLayout.ts";
import { hitTest } from "../src/ui/layout/hitTest.ts";
import { renderFrame } from "../src/ui/render/frame.ts";
import { stripAnsi } from "../src/ui/render/palette.ts";
import { PANEL_IDS, type PanelId } from "../src/ui/layout/types.ts";
import { EMPTY_DATA, buildFrameModel, type ResourceData } from "../src/ui/view/build.ts";
import { defaultTheme as theme } from "../src/theme/theme.ts";

const fx = (f: string) => JSON.parse(readFileSync(`test/fixtures/${f}`, "utf8"));
const data: ResourceData = { ...EMPTY_DATA, containers: fx("containers-list.json"), pods: fx("pods-list.json"), images: fx("images-list.json"), volumes: fx("volumes-list.json"), networks: fx("networks-list.json") };
const selected = Object.fromEntries(PANEL_IDS.map((p) => [p, ""])) as Record<PanelId, string>;

function frame(cols: number, rows: number) {
  const model = buildFrameModel({ data, selected, focus: "containers", now: Date.now(), clock: "9:41:00 AM" });
  const layout = computeLayout({ cols, rows, visible: new Set(PANEL_IDS), focused: "containers" });
  const lines = renderFrame(layout, model, { theme, color: false }).map(stripAnsi);
  /** Column (cells) of the first occurrence of `text` on line `y`. */
  const find = (text: string, from = 0): { x: number; y: number } => {
    for (let y = from; y < lines.length; y++) {
      const i = lines[y]!.indexOf(text);
      if (i >= 0) return { x: Bun.stringWidth(lines[y]!.slice(0, i)), y };
    }
    throw new Error(`"${text}" not on screen`);
  };
  return { model, layout, lines, find, hit: (x: number, y: number) => hitTest(layout, model, theme, x, y) };
}

describe.each([
  [120, 35],
  [200, 50],
  [100, 30],
])("at %ix%i", (cols, rows) => {
  test("a panel's [N] toggles; elsewhere on its title focuses", () => {
    const f = frame(cols, rows);
    const at = f.find("[3]");
    expect(f.hit(at.x + 1, at.y)).toEqual({ kind: "panelNumber", id: "images" });
    expect(f.hit(at.x + 6, at.y)).toEqual({ kind: "panelTitle", id: "images" });
  });

  test("a row click names that row's item", () => {
    const f = frame(cols, rows);
    for (const name of ["chatty", "failing"]) {
      const at = f.find(name);
      const id = data.containers.find((c) => c.Names[0] === name)!.Id;
      expect(f.hit(at.x, at.y)).toEqual({ kind: "panelRow", id: "containers", itemId: id });
    }
  });

  test("header tabs map to their panel", () => {
    const f = frame(cols, rows);
    const header = f.lines[0]!;
    for (const [n, id] of PANEL_IDS.entries()) {
      const x = Bun.stringWidth(header.slice(0, header.indexOf(String(n + 1), 8)));
      expect(f.hit(x, 0)).toEqual({ kind: "headerTab", id });
    }
    // The clock is not a tab.
    const clockX = Bun.stringWidth(header.slice(0, header.indexOf("9:41")));
    expect(f.hit(clockX, 0)).toEqual({ kind: "none" });
  });

  test("detail tabs and body", () => {
    const f = frame(cols, rows);
    const at = f.find("Logs Stats Env Config Top");
    expect(f.hit(at.x, at.y)).toEqual({ kind: "detailTab", index: 0 });
    expect(f.hit(at.x + "Logs Stats Env ".length, at.y)).toEqual({ kind: "detailTab", index: 3 });
    expect(f.hit(at.x + 4, at.y)).toEqual({ kind: "detailBody" }); // the space between
    expect(f.hit(at.x, at.y + 3)).toEqual({ kind: "detailBody" });
  });
});

test("the footer and the too-small screen are not targets", () => {
  const f = frame(120, 35);
  expect(f.hit(5, 34)).toEqual({ kind: "none" });
  const tiny = computeLayout({ cols: 20, rows: 5, visible: new Set(PANEL_IDS), focused: "containers" });
  expect(hitTest(tiny, f.model, theme, 1, 1)).toEqual({ kind: "none" });
});
