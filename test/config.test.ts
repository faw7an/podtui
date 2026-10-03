import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_POLL_MS, MAX_POLL_MS, MIN_POLL_MS, resolvePollMs } from "../src/config.ts";

/**
 * R-14: the poll interval was the literal `5000` inside App.tsx, so it could
 * only be changed by editing source and rebuilding. FR-2 requires a
 * *configurable* interval with a polling fallback, and P2-T6's acceptance is
 * that an override actually changes it.
 *
 * The validation rules exist because this value feeds `setInterval`: a typo like
 * `PODTUI_POLL_MS=0` would otherwise turn the app into a CPU-spinning poll loop
 * against a real daemon.
 */

afterEach(() => {
  delete process.env["PODTUI_POLL_MS"];
});

describe("resolvePollMs", () => {
  test("falls back to the default when unset or blank", () => {
    expect(resolvePollMs(undefined)).toBe(DEFAULT_POLL_MS);
    expect(resolvePollMs("")).toBe(DEFAULT_POLL_MS);
    expect(resolvePollMs("   ")).toBe(DEFAULT_POLL_MS);
  });

  test("uses a valid override verbatim", () => {
    expect(resolvePollMs("2000")).toBe(2000);
    expect(resolvePollMs("10000")).toBe(10000);
  });

  test("tolerates surrounding whitespace", () => {
    expect(resolvePollMs("  3000  ")).toBe(3000);
  });

  test("truncates a fractional value instead of rejecting it", () => {
    expect(resolvePollMs("1500.9")).toBe(1500);
  });

  test("clamps a too-fast interval up to the floor", () => {
    // 0 or a negative number in setInterval is a busy loop against the daemon.
    expect(resolvePollMs("0")).toBe(MIN_POLL_MS);
    expect(resolvePollMs("1")).toBe(MIN_POLL_MS);
    expect(resolvePollMs("-5")).toBe(MIN_POLL_MS);
  });

  test("clamps a too-slow interval down to the ceiling", () => {
    expect(resolvePollMs("999999999")).toBe(MAX_POLL_MS);
  });

  test("ignores nonsense rather than polling at NaN", () => {
    expect(resolvePollMs("abc")).toBe(DEFAULT_POLL_MS);
    expect(resolvePollMs("5s")).toBe(DEFAULT_POLL_MS);
    expect(resolvePollMs("NaN")).toBe(DEFAULT_POLL_MS);
    expect(resolvePollMs("Infinity")).toBe(DEFAULT_POLL_MS);
    expect(resolvePollMs("-Infinity")).toBe(DEFAULT_POLL_MS);
  });

  test("the documented floor and ceiling are sane numbers", () => {
    expect(MIN_POLL_MS).toBeGreaterThanOrEqual(100);
    expect(MAX_POLL_MS).toBeGreaterThan(MIN_POLL_MS);
    expect(DEFAULT_POLL_MS).toBeGreaterThan(MIN_POLL_MS);
    expect(DEFAULT_POLL_MS).toBeLessThan(MAX_POLL_MS);
  });
});

describe("PODTUI_POLL_MS end to end", () => {
  test("setting the env var changes the resolved interval", () => {
    // This is R-14's acceptance criterion: the override reaches the timer.
    expect(resolvePollMs(process.env["PODTUI_POLL_MS"])).toBe(DEFAULT_POLL_MS);
    process.env["PODTUI_POLL_MS"] = "1200";
    expect(resolvePollMs(process.env["PODTUI_POLL_MS"])).toBe(1200);
    process.env["PODTUI_POLL_MS"] = "not-a-number";
    expect(resolvePollMs(process.env["PODTUI_POLL_MS"])).toBe(DEFAULT_POLL_MS);
  });
});