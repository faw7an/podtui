/**
 * Tests for `src/util/format.ts`.
 *
 * `formatBytes` and `shortenImageName` used to be tested only through
 * `test/ui-layout.test.tsx`, which imported them via a re-export from
 * `src/ui/App.tsx` and otherwise exercised a dead `Panel` component. They moved
 * here when R-11 deleted that file; the re-export in `App.tsx` is gone too.
 *
 * The remaining exported helpers (`formatAge`, `parsePodmanTime`, `statusText`)
 * had no coverage at all and are pinned here against real fixture values.
 */

import { describe, expect, test } from "bun:test";
import {
  formatAge,
  formatBytes,
  parsePodmanTime,
  shortenImageName,
  statusText,
  toneForState,
} from "../src/util/format.ts";

describe("formatBytes", () => {
  test("formats with SI units to match podman", () => {
    expect(formatBytes(0)).toBe("0B");
    expect(formatBytes(8715873)).toBe("8.7MB");
    expect(formatBytes(64322556)).toBe("64.3MB");
  });

  test("bytes under 1000 print without a decimal point", () => {
    expect(formatBytes(1)).toBe("1B");
    expect(formatBytes(999)).toBe("999B");
  });

  test("negative and non-finite input never produce NaN or a negative size", () => {
    expect(formatBytes(-1)).toBe("0B");
    expect(formatBytes(Number.NaN)).toBe("0B");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0B");
  });

  test("climbs units and clamps at PB instead of running off the end", () => {
    expect(formatBytes(1000 ** 3)).toBe("1.0GB");
    expect(formatBytes(1000 ** 4)).toBe("1.0TB");
    expect(formatBytes(1000 ** 5)).toBe("1.0PB");
    // i is clamped to the last unit, so the number grows instead of the unit.
    expect(formatBytes(1000 ** 6)).toBe("1000.0PB");
  });
});

describe("shortenImageName", () => {
  test("strips docker.io/library prefix but keeps tag", () => {
    expect(shortenImageName("docker.io/library/nginx:alpine")).toBe("nginx:alpine");
  });

  test("strips a bare docker.io prefix", () => {
    expect(shortenImageName("docker.io/redis:7")).toBe("redis:7");
  });

  test("leaves other registries alone", () => {
    expect(shortenImageName("quay.io/podman/hello")).toBe("quay.io/podman/hello");
  });

  test("handles a local bare name and the empty string", () => {
    expect(shortenImageName("alpine")).toBe("alpine");
    expect(shortenImageName("")).toBe("");
  });
});

describe("formatAge", () => {
  const now = 1_700_000_000_000;

  test("formats minutes, hours and days coarsely enough for a status column", () => {
    expect(formatAge(now - 30_000, now)).toBe("now");
    expect(formatAge(now - 5 * 60_000, now)).toBe("5m");
    expect(formatAge(now - 3 * 3_600_000, now)).toBe("3h");
    expect(formatAge(now - 2 * 86_400_000, now)).toBe("2d");
  });

  test("a future timestamp reads as now, never a negative age", () => {
    expect(formatAge(now + 10_000, now)).toBe("now");
  });

  test("non-finite input renders as empty, so the column collapses", () => {
    expect(formatAge(Number.NaN, now)).toBe("");
    expect(formatAge(now - 1000, Number.NaN)).toBe("");
  });
});

describe("parsePodmanTime", () => {
  test("null and empty are absent, not zero", () => {
    expect(parsePodmanTime(undefined)).toBeNull();
    expect(parsePodmanTime(null)).toBeNull();
    expect(parsePodmanTime("")).toBeNull();
  });

  test("numeric input is unix SECONDS for images", () => {
    // 1_700_000_000 s = 1_700_000_000_000 ms, not year 51382.
    expect(parsePodmanTime(1_700_000_000)).toBe(1_700_000_000_000);
  });

  test("a pre-scaled millisecond number is passed through unchanged", () => {
    expect(parsePodmanTime(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  test("parses the RFC3339 strings containers and pods use", () => {
    expect(parsePodmanTime("2026-10-02T09:12:44.123456789+01:00")).toBe(
      Date.parse("2026-10-02T09:12:44.123456789+01:00"),
    );
  });

  test("an unparseable string is null rather than NaN", () => {
    expect(parsePodmanTime("not a date")).toBeNull();
  });
});

describe("statusText / toneForState", () => {
  test("carries a glyph as well as a colour, so NO_COLOR still reads", () => {
    const running = statusText("running");
    expect(running.text).toBe("● running");
    expect(running.tone).toBe("ok");
    expect(statusText("exited").text).toBe("✖ exited");
  });

  test("maps the states the real API was observed to report", () => {
    // Verified 2026-10-03 against the sandbox socket: `State.Status` took
    // exactly these values across create -> start -> pause -> unpause -> stop.
    expect(toneForState("created")).toBe("warn");
    expect(toneForState("running")).toBe("ok");
    expect(toneForState("paused")).toBe("warn");
    expect(toneForState("exited")).toBe("error");
  });

  test("is case-insensitive, because pods report `Status: \"Running\"`", () => {
    // test/fixtures/pods-list.json has Status "Running" and no State field.
    expect(toneForState("Running")).toBe("ok");
    expect(statusText("Running").text).toBe("● running");
  });

  test("an unknown state falls back to dim rather than throwing", () => {
    expect(toneForState("configured")).toBe("dim");
    expect(statusText("configured").tone).toBe("dim");
  });

  test("an empty state shows unknown instead of a bare glyph", () => {
    expect(statusText("").text).toBe("· unknown");
  });
});
