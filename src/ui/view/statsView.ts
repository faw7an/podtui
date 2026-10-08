import type { ContainerStatsUI } from "../../api/types.ts";
import { formatBytes } from "../../util/format.ts";

/**
 * Stats tab model (P3-T7). Pure: no Ink, no stream.
 *
 * Samples arrive once per second (`interval=1`, verified). The tab keeps the
 * last `STATS_HISTORY` of them for the sparklines and derives per-second
 * network and block rates from consecutive samples, because the API reports
 * those as running totals (as `podman stats` NET IO / BLOCK IO do).
 */

export const STATS_HISTORY = 60;

export interface StatsSample extends ContainerStatsUI {
  /** Wall-clock arrival, ms. Rates divide by the real gap, not by 1 s. */
  at: number;
}

export interface StatsHistory {
  samples: StatsSample[];
}

export const EMPTY_HISTORY: StatsHistory = { samples: [] };

export function pushSample(h: StatsHistory, sample: StatsSample, max = STATS_HISTORY): StatsHistory {
  const samples = [...h.samples, sample];
  if (samples.length > max) samples.splice(0, samples.length - max);
  return { samples };
}

const BARS = "▁▂▃▄▅▆▇█";

/**
 * One cell per value, newest on the right. `width` keeps the NEWEST values
 * when the history is wider than the room. Values scale to `max` (clamped);
 * zero draws the lowest bar so an idle container still shows a baseline.
 */
export function sparkline(values: readonly number[], width: number, max: number): string {
  if (width <= 0) return "";
  const shown = values.slice(Math.max(0, values.length - width));
  const top = max > 0 ? max : 1;
  return shown
    .map((v) => {
      const ratio = Math.min(1, Math.max(0, (Number.isFinite(v) ? v : 0) / top));
      return BARS[Math.min(BARS.length - 1, Math.round(ratio * (BARS.length - 1)))] ?? BARS[0];
    })
    .join("");
}

/** Bytes per second between the last two samples; null until there are two. */
export function rate(h: StatsHistory, pick: (s: StatsSample) => number): number | null {
  const n = h.samples.length;
  const a = h.samples[n - 2];
  const b = h.samples[n - 1];
  if (!a || !b) return null;
  const dt = (b.at - a.at) / 1000;
  if (dt <= 0) return null;
  // A counter that went backwards (container restarted) is not a rate.
  const d = pick(b) - pick(a);
  return d < 0 ? null : d / dt;
}

export const formatPercent = (v: number): string => `${(Number.isFinite(v) ? v : 0).toFixed(1)}%`;
const formatRate = (v: number | null): string => (v === null ? "…" : `${formatBytes(v)}/s`);

export interface StatsRow {
  label: string;
  value: string;
  /** Optional sparkline values and scale. */
  spark?: { values: number[]; max: number };
}

/**
 * Rows for the newest sample. CPU scales to 100% of one core, or higher when
 * the history went higher (multi-core containers exceed 100%); memory scales
 * to its limit so the line shows how close the container is to it.
 */
export function statsRows(h: StatsHistory): StatsRow[] {
  const s = h.samples.at(-1);
  if (!s) return [];
  const cpu = h.samples.map((x) => x.cpuPercent);
  const mem = h.samples.map((x) => x.memPercent);
  return [
    {
      label: "CPU",
      value: `${formatPercent(s.cpuPercent)} (avg ${formatPercent(s.avgCpuPercent)})`,
      spark: { values: cpu, max: Math.max(100, ...cpu) },
    },
    {
      label: "Memory",
      value: `${formatBytes(s.memUsage)} / ${s.memLimit > 0 ? formatBytes(s.memLimit) : "no limit"} (${formatPercent(s.memPercent)})`,
      spark: { values: mem, max: 100 },
    },
    {
      label: "Net I/O",
      value: `${formatBytes(s.netRx)} rx / ${formatBytes(s.netTx)} tx · ${formatRate(rate(h, (x) => x.netRx))} rx, ${formatRate(rate(h, (x) => x.netTx))} tx`,
    },
    {
      label: "Block I/O",
      value: `${formatBytes(s.blockRead)} read / ${formatBytes(s.blockWrite)} written`,
    },
    { label: "PIDs", value: String(s.pids) },
  ];
}
