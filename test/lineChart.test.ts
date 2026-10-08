/**
 * Stats charts drawn like docs/design/stats-reference-*.png.
 */

import { describe, expect, test } from "bun:test";
import { chartRows, resample } from "../src/ui/render/lineChart.ts";
import { statsCharts } from "../src/ui/render/detailLines.ts";
import { EMPTY_HISTORY, pushSample, type StatsHistory } from "../src/ui/view/statsView.ts";
import { stripAnsi } from "../src/ui/render/palette.ts";
import { displayWidth } from "../src/util/fit.ts";
import { defaultTheme } from "../src/theme/theme.ts";

describe("resample", () => {
  test("fewer samples than columns: each spans several columns (the steps)", () => {
    expect(resample([1, 2], 4)).toEqual([1, 1, 2, 2]);
  });
  test("more samples than columns: the newest ones", () => {
    expect(resample([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  });
  test("nothing to draw", () => {
    expect(resample([], 5)).toEqual([]);
    expect(resample([1], 0)).toEqual([]);
  });
});

describe("chartRows", () => {
  test("labels 0..peak on every row, axis ticks, box-drawing steps, exact width", () => {
    const c = chartRows([0, 0, 10, 20, 20, 10], 20, 3);
    expect(c.rows).toEqual([
      // 6 samples over 13 plot columns: 0,0,0,0,0,10,10,20,20,20,20,10,10
      "20.00 ┤       ╭───╮ ",
      "10.00 ┤     ╭─╯   ╰─",
      " 0.00 ┼─────╯       ",
    ]);
    for (const r of c.rows) expect(displayWidth(r)).toBe(20);
    expect(c.axisWidth).toBe(7);
  });

  test("a flat zero line still gets a readable 0..1 axis", () => {
    const c = chartRows([0, 0, 0], 12, 2);
    expect(c.rows).toEqual(["1.00 ┤      ", "0.00 ┼──────"]);
  });

  test("tiny values get enough decimals to stay distinct", () => {
    const labels = chartRows([0.004, 0.009], 30, 6).rows.map((r) => r.split(" ┤")[0]!.split(" ┼")[0]!.trim());
    expect(new Set(labels).size).toBe(6);
    expect(labels[0]).toBe("0.0090");
  });
});

describe("Stats tab layout", () => {
  let h: StatsHistory = EMPTY_HISTORY;
  for (let i = 0; i < 31; i++) {
    h = pushSample(h, { cpuPercent: i > 20 ? 19.25 : 0, avgCpuPercent: 1, memUsage: 1_000_000, memLimit: 2_000_000_000, memPercent: i > 20 ? 1.58 : 0, netRx: 320_740, netTx: 7_910, blockRead: 0, blockWrite: 0, pids: 56, at: i * 1000 });
  }

  test("CPU and Memory charts with captions, then PIDs and traffic, like the reference", () => {
    const rows = statsCharts(h, 40, 80, defaultTheme, false)!;
    expect(rows.length).toBeLessThanOrEqual(40);
    const text = rows.join("\n");
    expect(text).toContain("CPU (%): 19.25 (30s)");
    expect(text).toContain("Memory (%): 1.58 (30s)");
    expect(text).toContain("PIDs: 56");
    expect(text).toContain("Traffic received: 320.7KB");
    expect(text).toContain("Traffic sent: 7.9KB");
    expect(rows.indexOf(rows.find((r) => r.includes("CPU (%)"))!)).toBeLessThan(rows.indexOf(rows.find((r) => r.includes("Memory (%)"))!));
  });

  test("coloured rows keep their width", () => {
    for (const r of statsCharts(h, 40, 80, defaultTheme, true)!) expect(displayWidth(stripAnsi(r))).toBeLessThanOrEqual(80);
  });

  test("small panes keep charts, giving up text first, then the memory chart", () => {
    const at = (b: number) => statsCharts(h, b, 80, defaultTheme, false)!.join("\n");
    expect(at(11)).toContain("Memory (%)");
    expect(at(11)).toContain("PIDs: 56");
    expect(at(8)).toContain("Memory (%)");
    expect(at(8)).not.toContain("PIDs");
    expect(at(5)).toContain("CPU (%)");
    expect(at(5)).not.toContain("Memory (%)");
    expect(at(5)).toMatch(/┤|┼/);
    // Too small for any chart: just the two current values.
    expect(statsCharts(h, 2, 80, defaultTheme, false)).toEqual(["CPU (%): 19.25 (30s)", "Memory (%): 1.58 (30s)"]);
    for (const b of [2, 5, 8, 11, 40]) expect(statsCharts(h, b, 80, defaultTheme, false)!.length).toBeLessThanOrEqual(b);
    expect(statsCharts(EMPTY_HISTORY, 40, 80, defaultTheme, false)).toBeNull();
  });

});

test("a tiny current value is not shown as 0.00 in the caption", () => {
  let tiny = EMPTY_HISTORY;
  for (let i = 0; i < 5; i++) tiny = pushSample(tiny, { cpuPercent: 0.5, avgCpuPercent: 0, memUsage: 1, memLimit: 1e9, memPercent: 0.004, netRx: 0, netTx: 0, blockRead: 0, blockWrite: 0, pids: 1, at: i * 1000 });
  const text = statsCharts(tiny, 30, 80, defaultTheme, false)!.join("\n");
  expect(text).toContain("Memory (%): 0.0040 (4s)");
  expect(text).toContain("CPU (%): 0.50 (4s)");
});
