import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPodmanEngine, mapContainerStats } from "../src/engine/podman.ts";
import type { ContainerStats } from "../src/api/types.ts";
import { startThrowawayPodman, THROWAWAY_IMAGE as A, type ThrowawayPodman } from "./helpers/throwawayPodman.ts";

/**
 * Stats mapping (P1-T7 mapper, feeds P3-T7). The API's CPU and memory
 * percentages are already percentages; the mapper used to multiply them by
 * 100 (see docs/DECISIONS.md 2026-10-08).
 */

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "containers-stats.json"), "utf8"),
) as { Stats: ContainerStats[] };

describe("mapContainerStats against the recorded fixture", () => {
  test("memory percent equals MemUsage / MemLimit × 100 (it is not a fraction)", () => {
    for (const [raw, ui] of fixture.Stats.map((s) => [s, mapContainerStats([s])[0]!] as const)) {
      expect(ui.memPercent).toBeCloseTo((raw.MemUsage / raw.MemLimit) * 100, 3);
    }
  });

  test("CPU percent passes through unchanged", () => {
    for (const raw of fixture.Stats) {
      expect(mapContainerStats([raw])[0]!.cpuPercent).toBe(raw.AvgCPU);
    }
  });

  test("network bytes are summed across interfaces; missing fields read as 0", () => {
    const raw = {
      ...fixture.Stats[0]!,
      Network: { eth0: { RxBytes: 10, TxBytes: 1 }, eth1: { RxBytes: 5, TxBytes: 2 } },
      BlockInput: undefined,
      PIDs: undefined,
    } as unknown as ContainerStats;
    const ui = mapContainerStats([raw])[0]!;
    expect(ui.netRx).toBe(15);
    expect(ui.netTx).toBe(3);
    expect(ui.blockRead).toBe(0);
    expect(ui.pids).toBe(0);
  });
});

const enabled = Boolean(process.env["PODTUI_INTEGRATION"]);
let t: ThrowawayPodman;

describe.skipIf(!enabled)("stats agree with `podman stats` (live)", () => {
  beforeAll(async () => {
    t = await startThrowawayPodman();
    // One busy loop: roughly 100% of one CPU.
    await t.podman("run", "-d", "--name", "busy", "--memory", "256m", A, "sh", "-c", "yes > /dev/null");
    await Bun.sleep(3000);
  }, 120_000);

  afterAll(async () => {
    await t?.stop();
  }, 60_000);

  test("CPU and memory percentages match the CLI's scale", async () => {
    const engine = createPodmanEngine();
    const [ui] = mapContainerStats((await engine.containerStats(t.socket, ["busy"], false)) as ContainerStats[]);
    const cli = await t.podman("stats", "--no-stream", "--format", "{{.CPUPerc}} {{.MemPerc}}", "busy");
    const [cliCpu, cliMem] = cli.split(" ").map((v) => Number.parseFloat(v));

    // A busy loop is tens of percent or more of a CPU, never thousands.
    expect(ui!.cpuPercent).toBeGreaterThan(20);
    expect(ui!.cpuPercent).toBeLessThan(800);
    // Same scale as the CLI (samples differ slightly in time).
    expect(Math.abs(ui!.cpuPercent - cliCpu!)).toBeLessThan(60);
    expect(ui!.memPercent).toBeLessThan(5);
    expect(Math.abs(ui!.memPercent - cliMem!)).toBeLessThan(1);
  }, 60_000);
});
