import type { ContainerTop } from "../../api/types.ts";

/**
 * Top tab (P3-T8). Pure: turns `GET /containers/{id}/top` into aligned rows.
 *
 * Verified on Podman 5.8.4 (fixture `container-top.json`): `Titles` is
 * `USER PID PPID %CPU ELAPSED TTY TIME COMMAND` and every process is an array
 * of strings in that order. ELAPSED/TIME are Go durations with nanoseconds
 * (`1h1m21.409957373s`), shortened here to whole seconds.
 *
 * Columns are found by TITLE, not by position, so a Podman that adds or
 * reorders columns still lines up; unknown columns are shown as they come.
 */

/** Refresh interval while the tab is visible. Top is a snapshot, not a stream. */
export const TOP_POLL_MS = 2000;

const NUMERIC = new Set(["PID", "PPID", "%CPU", "%MEM", "VSZ", "RSS"]);
const DURATION = new Set(["ELAPSED", "TIME"]);

/** `1h1m21.409957373s` → `1h1m21s`; `2.22034985s` → `2s`; `0s` stays. */
export function shortDuration(value: string): string {
  return value.replace(/(\d+)\.\d+s$/, "$1s");
}

export interface TopTable {
  /** Header first, then one row per process, columns aligned. */
  lines: string[];
  processes: number;
}

export function topTable(top: ContainerTop): TopTable {
  const titles = top.Titles ?? [];
  const procs = top.Processes ?? [];
  const cell = (row: string[], i: number): string => {
    const raw = row[i] ?? "";
    return DURATION.has(titles[i] ?? "") ? shortDuration(raw) : raw;
  };
  const last = titles.length - 1;
  const widths = titles.map((t, i) =>
    i === last ? 0 : Math.max(t.length, ...procs.map((p) => cell(p, i).length)),
  );
  const fmt = (values: string[]): string =>
    values
      .map((v, i) => {
        if (i === last) return v;
        return NUMERIC.has(titles[i] ?? "") ? v.padStart(widths[i] ?? 0) : v.padEnd(widths[i] ?? 0);
      })
      .join("  ");
  return {
    lines: [fmt(titles), ...procs.map((p) => fmt(titles.map((_, i) => cell(p, i))))],
    processes: procs.length,
  };
}
