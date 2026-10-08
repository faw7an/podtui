/**
 * Stats charts drawn like docs/design/stats-reference-*.png.
 */

import { describe, expect, test } from "bun:test";
import { chartRows, resample } from "../src/ui/render/lineChart.ts";
import { statsCharts, MIN_CHART_ROWS } from "../src/ui/render/detailLines.ts";
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

  test("too short for charts: null (the compact view is used)", () => {
    expect(statsCharts(h, 8 + 2 * (MIN_CHART_ROWS + 2) - 1, 80, defaultTheme, false)).toBeNull();
    expect(statsCharts(EMPTY_HISTORY, 40, 80, defaultTheme, false)).toBeNull();
  });
});
