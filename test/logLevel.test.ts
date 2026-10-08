/**
 * Tests for `src/util/logLevel.ts` (P3-T1, FR-5).
 *
 * Table-driven: each row is a real-looking log line and the level it must get.
 * The false-positive table matters as much as the positive one — a Logs tab
 * that paints prose red is worse than one that paints nothing.
 */

import { describe, expect, test } from "bun:test";
import { classifyLogLine, stripAnsi, type LogLevel } from "../src/util/logLevel.ts";

type Row = [line: string, level: LogLevel];

const cases: Record<string, Row[]> = {
  "sandbox seed lines (scripts/dev-sandbox.sh `failing`, `chatty`)": [
    ["ERROR something broke", "error"],
    ["WARN low disk", "warn"],
    ["Thu Oct  8 10:00:00 UTC 2026 - log line from chatty", "unknown"],
  ],
  "upper-case whole-word tokens": [
    ["2026-10-08T10:00:00Z FATAL cannot bind :8080", "error"],
    ["CRITICAL: disk full", "error"],
    ["10:00:00 PANIC oh no", "error"],
    ["WARNING: deprecated flag", "warn"],
    ["INFO server started", "info"],
    ["NOTICE config reloaded", "info"],
    ["DEBUG cache miss key=a", "debug"],
    ["TRACE enter handler", "debug"],
    ["E ERR connection refused", "error"],
  ],
  "bracketed tokens, any case": [
    ["2026/10/08 10:00:00 [error] 12#12: *1 open() failed", "error"],
    ["2026/10/08 10:00:00 [warn] 12#12: conflicting server name", "warn"],
    ["2026/10/08 10:00:00 [notice] 1#1: start worker processes", "info"],
    ["[Debug] loaded 3 plugins", "debug"],
    ["<crit> kernel oops", "error"],
  ],
  "colon-suffixed tokens, any case": [
    ["error: failed to open config", "error"],
    ["Error: ENOENT: no such file or directory", "error"],
    ["warning: unused variable", "warn"],
    ["panic: runtime error: index out of range", "error"],
    ["fatal: not a git repository", "error"],
  ],
  "structured fields": [
    ['{"level":"error","msg":"db down"}', "error"],
    ['{"time":"x","level":"WARN","msg":"slow"}', "warn"],
    ['{"severity":"INFO","message":"ok"}', "info"],
    ['{"lvl": "debug", "msg": "x"}', "debug"],
    ["time=2026-10-08 level=error msg=boom", "error"],
    ['ts=1 level="warning" msg="slow query"', "warn"],
    ["lvl=info msg=started", "info"],
    ["severity=critical component=api", "error"],
  ],
  "structured field beats words in the message": [
    ['{"level":"info","msg":"recovered from ERROR"}', "info"],
    ["level=debug msg=\"retrying after FATAL\"", "debug"],
  ],
  "unrecognised structured value falls through": [
    ['{"level":"verbose","msg":"WARN quota"}', "warn"],
  ],
  "earliest token wins": [
    ["INFO retrying after ERROR from upstream", "info"],
    ["ERROR request failed, INFO will retry", "error"],
    ["[warn] then error: later", "warn"],
  ],
  "exception markers": [
    ["java.lang.NullPointerException: null", "error"],
    ["Traceback (most recent call last):", "error"],
    ["TypeError: Cannot read properties of undefined", "error"],
    ["  raise ValueError(\"bad\")", "error"],
  ],
  "ANSI colour around the token": [
    ["\x1b[31mERROR\x1b[0m boom", "error"],
    ["\x1b[33m[warn]\x1b[0m slow", "warn"],
    ["time=1 \x1b[1mlevel\x1b[0m=error", "error"],
  ],
};

const falsePositives: Row[] = [
  ["the terror of production", "unknown"],
  ["ERRORS: 0", "unknown"],
  ["ERROR_CODE=0 all fine", "unknown"],
  ["no error found", "unknown"],
  ["errors were handled", "unknown"],
  ["Error handling enabled", "unknown"],
  ["Exception handling enabled", "unknown"],
  ["see information page", "unknown"],
  ["attached debugger", "unknown"],
  ["warning signs ahead", "unknown"],
  ["WARNINGS suppressed", "unknown"],
  ["INFORMATION only", "unknown"],
  ["mylevel=error is a different key", "unknown"],
  ["config.level=error is a different key", "unknown"],
  ["0 errors, 0 warnings", "unknown"],
  ["", "unknown"],
  ["   ", "unknown"],
];

describe("classifyLogLine", () => {
  for (const [group, rows] of Object.entries(cases)) {
    describe(group, () => {
      test.each(rows)("%p → %p", (line, level) => {
        expect(classifyLogLine(line)).toBe(level);
      });
    });
  }

  describe("false positives stay unknown", () => {
    test.each(falsePositives)("%p → %p", (line, level) => {
      expect(classifyLogLine(line)).toBe(level);
    });
  });

  test("is stateless: repeated calls give the same answer (no global regex leak)", () => {
    for (let i = 0; i < 3; i++) {
      expect(classifyLogLine("WARN a")).toBe("warn");
      expect(classifyLogLine("x [error] y")).toBe("error");
      expect(classifyLogLine("debug: z")).toBe("debug");
    }
  });
});

describe("stripAnsi", () => {
  test("removes SGR and OSC sequences, keeps text", () => {
    expect(stripAnsi("\x1b[1;31mred\x1b[0m plain")).toBe("red plain");
    expect(stripAnsi("\x1b]8;;http://x\x07link\x1b]8;;\x07")).toBe("link");
  });
});
