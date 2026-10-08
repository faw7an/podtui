import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPodmanEngine, graceDeadlineMs } from "../src/engine/podman.ts";
import { startThrowawayPodman, THROWAWAY_IMAGE as A, type ThrowawayPodman } from "./helpers/throwawayPodman.ts";

/**
 * Stop grace periods (review 2026-10-08). The libpod endpoints read the grace
 * period from `timeout`, not Docker's `t`; restart defaults it to 0. The old
 * engine sent `t`, so restart SIGKILLed containers immediately and stop
 * ignored the caller's value. These tests observe the real behaviour on a
 * throwaway Podman.
 */

describe("graceDeadlineMs", () => {
  test("the HTTP deadline outlasts the grace period", () => {
    expect(graceDeadlineMs(0)).toBeGreaterThan(0);
    expect(graceDeadlineMs(10)).toBeGreaterThan(10_000);
    expect(graceDeadlineMs(600)).toBeGreaterThan(600_000);
  });
});

const enabled = Boolean(process.env["PODTUI_INTEGRATION"]);
const engine = createPodmanEngine();
let t: ThrowawayPodman;

/** Logs "graceful" only when it receives SIGTERM AND gets ~1s to shut down. */
const TERM_HANDLER = 'trap "sleep 1; echo graceful; exit 0" TERM; echo up; while true; do sleep 0.2; done';

async function runFresh(name: string, ...args: string[]) {
  await t.podmanStatus("rm", "-f", "-t", "0", name);
  await t.podman("run", "-d", "--name", name, ...args);
  await Bun.sleep(400);
}

describe.skipIf(!enabled)("container actions honour stop grace periods", () => {
  beforeAll(async () => {
    t = await startThrowawayPodman();
  }, 120_000);

  afterAll(async () => {
    await t?.stop();
  }, 60_000);

  test("restart lets the container shut down gracefully (was SIGKILLed in ~100ms)", async () => {
    await runFresh("graceful", A, "sh", "-c", TERM_HANDLER);
    await engine.restartContainer(t.socket, "graceful");
    expect(await t.podman("logs", "graceful")).toContain("graceful");
  }, 60_000);

  test("stop honours an explicit grace period (was ignored: waited the 10s default)", async () => {
    // PID 1 `sleep` ignores SIGTERM, so stop takes exactly the grace period.
    await runFresh("stubborn", A, "sleep", "600");
    const started = Date.now();
    await engine.stopContainer(t.socket, "stubborn", 1);
    const ms = Date.now() - started;
    expect(ms).toBeGreaterThanOrEqual(900);
    expect(ms).toBeLessThan(5000);
  }, 60_000);

  test("without a value, the container's own --stop-timeout is used", async () => {
    await runFresh("configured", "--stop-timeout", "2", A, "sleep", "600");
    const started = Date.now();
    await engine.stopContainer(t.socket, "configured");
    const ms = Date.now() - started;
    expect(ms).toBeGreaterThanOrEqual(1900);
    expect(ms).toBeLessThan(6000);
  }, 60_000);

  test("a forced remove that needs the full 10s grace does not time out client-side", async () => {
    // Took 10.07s live, against the old fixed 10s client timeout.
    await runFresh("slowrm", A, "sleep", "600");
    const result = await engine.removeContainer(t.socket, "slowrm", true);
    expect(result.success).toBe(true);
    const exists = await t.podmanStatus("container", "exists", "slowrm");
    expect(exists.code).not.toBe(0);
  }, 60_000);

  test("stopping a pod whose containers need their full grace period succeeds", async () => {
    await t.podmanStatus("pod", "rm", "-f", "-t", "0", "gp");
    await t.podman("pod", "create", "--name", "gp");
    await t.podman("run", "-d", "--pod", "gp", "--name", "gp-a", A, "sleep", "600");
    await Bun.sleep(400);
    const result = await engine.stopPod(t.socket, "gp");
    expect(result.success).toBe(true);
  }, 60_000);
});
