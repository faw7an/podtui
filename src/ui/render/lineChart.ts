import { fg, paint } from "./palette.ts";

/**
 * Line chart for the Stats tab, drawn like the reference screenshots
 * (docs/design/stats-reference-*.png): a labelled Y axis from 0 to the
 * peak, `┤` ticks, and a stepped line of box-drawing characters.
 *
 *   25.74 ┤            ╭──╮
 *   12.87 ┤      ╭─────╯  ╰──
 *    0.00 ┼──────╯
 *
 * Pure: values in, plain rows out (`chartRows`), so the geometry is
 * testable without colour; `paintChart` adds the series colour.
 */

/**
 * Fit `values` to `width` columns, newest on the right. More samples than
 * columns: the newest `width`. Fewer: each sample spans several columns
 * (which is what makes the steps).
 */
export function resample(values: readonly number[], width: number): number[] {
  if (width <= 0 || values.length === 0) return [];
  if (values.length >= width) return values.slice(values.length - width);
  return Array.from({ length: width }, (_, x) => values[Math.floor((x * values.length) / width)] ?? 0);
}

export interface Chart {
  /** Label column width, incl. the trailing " ┤" axis (for aligning captions). */
  axisWidth: number;
  /** One string per row, top to bottom; each exactly `width` cells. */
  rows: string[];
}

/**
 * Plain chart rows. `height` rows tall, `width` cells wide (labels + axis +
 * plot). The scale runs from 0 to the peak (at least 1, so a flat zero line
 * still has a readable axis), labelled with two decimals on every row.
 */
export function chartRows(values: readonly number[], width: number, height: number): Chart {
  const h = Math.max(2, Math.floor(height));
  const peak = Math.max(...values.map((v) => (Number.isFinite(v) ? v : 0)), 0);
  const max = peak > 0 ? peak : 1;
  // Two decimals like the reference, more when the steps are smaller than
  // that (a container using 0.01% memory would otherwise label every row
  // 0.00 or 0.01); at most four.
  const step = max / (h - 1);
  const decimals = Math.min(4, Math.max(2, Math.ceil(-Math.log10(step)) + 1));
  const labels = Array.from({ length: h }, (_, i) => ((max * (h - 1 - i)) / (h - 1)).toFixed(decimals));
  const labelW = Math.max(...labels.map((l) => l.length));
  const axisWidth = labelW + 2;
  const plotW = Math.max(0, width - axisWidth);
  const series = resample(values, plotW);
  const level = (v: number): number => Math.round(((Number.isFinite(v) ? Math.max(0, v) : 0) / max) * (h - 1));
  const lv = series.map(level);

  // grid[row][col], row 0 = top.
  const grid: string[][] = Array.from({ length: h }, () => Array.from({ length: plotW }, () => " "));
  const put = (lvl: number, x: number, ch: string): void => {
    const row = h - 1 - lvl;
    const line = grid[row];
    if (line && x >= 0 && x < plotW) line[x] = ch;
  };
  for (let x = 0; x < lv.length; x++) {
    const cur = lv[x] ?? 0;
    const prev = x === 0 ? cur : (lv[x - 1] ?? cur);
    if (cur === prev) {
      put(cur, x, "─");
      continue;
    }
    const up = cur > prev;
    put(prev, x, up ? "╯" : "╮");
    put(cur, x, up ? "╭" : "╰");
    for (let l = Math.min(cur, prev) + 1; l < Math.max(cur, prev); l++) put(l, x, "│");
  }

  const startRow = h - 1 - (lv[0] ?? 0);
  const rows = grid.map((cells, row) => {
    const tick = row === startRow && plotW > 0 ? "┼" : "┤";
    return `${(labels[row] ?? "").padStart(labelW)} ${tick}${cells.join("")}`.slice(0, Math.max(0, width)).padEnd(Math.max(0, width));
  });
  return { axisWidth, rows };
}

/** The chart in `color`, the way the reference draws it (axis and line alike). */
export function paintChart(chart: Chart, color: string, on: boolean): string[] {
  return on ? chart.rows.map((r) => paint(r.trimEnd(), [fg(color)]) + " ".repeat(r.length - r.trimEnd().length)) : chart.rows;
}
