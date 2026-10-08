/**
 * Stats tab (P3-T7): history, sparkline, rates, rows, rendering and the
 * stream lifecycle with a fake engine (P3-T9).
 */

import { describe, expect, test } from "bun:test";
import type { ContainerStatsUI } from "../src/api/types.ts";
import {
  EMPTY_HISTORY,
  pushSample,
  rate,
  sparkline,
  statsRows,
  type StatsHistory,
  type StatsSample,
} from "../src/ui/view/statsView.ts";
import { startStatsSession, type StatsStreamStatus } from "../src/ui/view/statsSession.ts";
import { renderDetail } from "../src/ui/render/detailLines.ts";
import { stripAnsi } from "../src/ui/render/palette.ts";
import { displayWidth } from "../src/util/fit.ts";
import { defaultTheme } from "../src/theme/theme.ts";
import type { DetailStatsModel } from "../src/ui/view/model.ts";

const base: ContainerStatsUI = {
  cpuPercent: 0,
  avgCpuPercent: 0,
  memUsage: 1_000_000,
  memLimit: 16_000_000_000,
  memPercent: 0.00625,
  netRx: 0,
  netTx: 0,
  blockRead: 0,
  blockWrite: 0,
  pids: 2,
};
const sample = (at: number, over: Partial<ContainerStatsUI> = {}): StatsSample => ({ ...base, ...over, at });

function history(...samples: StatsSample[]): StatsHistory {
  return samples.reduce((h, s) => pushSample(h, s), EMPTY_HISTORY);
}

describe("history and sparkline", () => {
  test("keeps the last 60 samples", () => {
    let h = EMPTY_HISTORY;
    for (let i = 0; i < 100; i++) h = pushSample(h, sample(i * 1000, { cpuPercent: i }));
    expect(h.samples).toHaveLength(60);
    expect(h.samples[0]?.cpuPercent).toBe(40);
  });

  test("sparkline: one cell per value, scaled, newest kept when narrow", () => {
    expect(sparkline([0, 50, 100], 3, 100)).toBe("▁▅█");
    expect(sparkline([0, 50, 100], 2, 100)).toBe("▅█");
    expect(sparkline([200], 1, 100)).toBe("█"); // clamped
    expect(sparkline([Number.NaN], 1, 100)).toBe("▁");
    expect(sparkline([1, 2], 0, 100)).toBe("");
  });

  test("rate uses the real gap between samples and ignores counter resets", () => {
    expect(rate(history(sample(0)), (s) => s.netRx)).toBeNull();
    expect(rate(history(sample(0, { netRx: 0 }), sample(2000, { netRx: 4000 })), (s) => s.netRx)).toBe(2000);
    expect(rate(history(sample(0, { netRx: 9000 }), sample(1000, { netRx: 10 })), (s) => s.netRx)).toBeNull();
  });
});

describe("statsRows", () => {
  test("live CPU with the average beside it; memory against its limit", () => {
    const rows = statsRows(history(sample(0, { cpuPercent: 99.5, avgCpuPercent: 0.6 })));
    expect(rows.map((r) => r.label)).toEqual(["CPU", "Memory", "Net I/O", "Block I/O", "PIDs"]);
    expect(rows[0]?.value).toBe("99.5% (avg 0.6%)");
    expect(rows[1]?.value).toBe("1.0MB / 16.0GB (0.0%)");
    expect(rows[4]?.value).toBe("2");
  });

  test("CPU sparkline scales past 100% for multi-core load", () => {
    const rows = statsRows(history(sample(0, { cpuPercent: 250 })));
    expect(rows[0]?.spark?.max).toBe(250);
  });

  test("no memory limit reads as such", () => {
    expect(statsRows(history(sample(0, { memLimit: 0 })))[1]?.value).toContain("no limit");
  });
});

describe("Stats tab render", () => {
  const rect = { x: 0, y: 0, w: 50, h: 14 };
  const render = (stats: DetailStatsModel): string[] =>
    renderDetail(rect, { title: "t", tabs: ["Stats"], activeTab: 0, lines: [], stats }, { theme: defaultTheme, color: true });
  const content = (out: string[]): string[] => out.slice(2, -1).map((l) => stripAnsi(l).slice(1, -1).trimEnd());

  test("a stopped container says so instead of drawing zeros", () => {
    const out = render({ history: EMPTY_HISTORY, status: { kind: "idle" }, state: "exited", name: "failing" });
    expect(content(out)[0]).toContain("failing is not running (exited)");
    for (const line of out) expect(displayWidth(line)).toBe(rect.w);
  });

  test("rows, sparklines sized to the pane, exact widths", () => {
    let h = EMPTY_HISTORY;
    for (let i = 0; i < 60; i++) h = pushSample(h, sample(i * 1000, { cpuPercent: i === 59 ? 100 : 0 }));
    const out = render({ history: h, status: { kind: "live" }, state: "running", name: "chatty" });
    for (const line of out) expect(displayWidth(line)).toBe(rect.w);
    const rows = content(out);
    expect(rows[0]).toMatch(/^CPU +100\.0% \(avg 0\.0%\)$/);
    // 48 inner cells - 11 label = 37 sparkline cells, newest (the spike) last.
    expect(rows[1]?.trim()).toBe("▁".repeat(36) + "█");
    expect(stripAnsi(out.at(-1) ?? "")).toContain("live · 1 s");
  });

  test("waiting and error states", () => {
    expect(content(render({ history: EMPTY_HISTORY, status: { kind: "connecting" }, state: "running", name: "x" }))[0]).toBe("Waiting for the first sample…");
    expect(content(render({ history: EMPTY_HISTORY, status: { kind: "error", message: "boom" }, state: "running", name: "x" }))[0]).toBe("Stats unavailable: boom");
  });
});

describe("startStatsSession", () => {
  function fakeEngine() {
    let open = 0;
    let closed = 0;
    let push: ((s: ContainerStatsUI) => void) | undefined;
    let options: { interval?: number; signal?: AbortSignal } | undefined;
    const engine = {
      streamStats(_s: string, _id: string, opts: { interval?: number; signal?: AbortSignal } = {}) {
        open++;
        options = opts;
        const queue: ContainerStatsUI[] = [];
        let wake: (() => void) | undefined;
        push = (s) => {
          queue.push(s);
          wake?.();
        };
        opts.signal?.addEventListener("abort", () => wake?.());
        return (async function* () {
          try {
            for (;;) {
              while (queue.length) yield queue.shift() as ContainerStatsUI;
              if (opts.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
              await new Promise<void>((r) => (wake = r));
            }
          } finally {
            closed++;
          }
        })();
      },
    };
    return { engine, push: (s: ContainerStatsUI) => push?.(s), counts: () => ({ open, closed }), options: () => options };
  }

  test("asks for 1 s samples, stamps arrival time, stop closes, abort is not an error", async () => {
    const f = fakeEngine();
    const samples: StatsSample[] = [];
    const statuses: StatsStreamStatus["kind"][] = [];
    let clock = 5000;
    const stop = startStatsSession(f.engine, "/tmp/podtui-test/x.sock", "c", {
      onSample: (s) => samples.push(s),
      onStatus: (s) => statuses.push(s.kind),
      now: () => clock,
    });
    await Bun.sleep(1);
    expect(f.options()?.interval).toBe(1);
    f.push(base);
    await Bun.sleep(1);
    clock = 6000;
    f.push({ ...base, cpuPercent: 50 });
    await Bun.sleep(1);
    expect(samples.map((s) => [s.at, s.cpuPercent])).toEqual([[5000, 0], [6000, 50]]);
    stop();
    await Bun.sleep(5);
    expect(f.counts()).toEqual({ open: 1, closed: 1 });
    expect(statuses).toEqual(["connecting", "live"]);
  });
});
