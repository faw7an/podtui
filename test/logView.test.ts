/**
 * Tests for `src/ui/view/logView.ts` (P3-T2): follow, pause, scroll, the
 * "new lines below" count, and staying put while the ring drops lines.
 */

import { describe, expect, test } from "bun:test";
import { LogBuffer } from "../src/util/logBuffer.ts";
import {
  FOLLOW,
  logWindow,
  reduceLogView,
  type LogViewAction,
  type LogViewState,
} from "../src/ui/view/logView.ts";

const T = new Date(0);

function filled(n: number, capacity = 5000): LogBuffer {
  const b = new LogBuffer(capacity);
  for (let i = 0; i < n; i++) b.push({ stream: "stdout", timestamp: T, message: `l${i}\n` });
  return b;
}

function add(b: LogBuffer, n: number): void {
  const start = b.nextSeq;
  for (let i = 0; i < n; i++) b.push({ stream: "stdout", timestamp: T, message: `l${start + i}\n` });
}

const shown = (v: LogViewState, b: LogBuffer, h: number): string[] =>
  logWindow(v, b, h).lines.map((l) => l.text);

function run(v: LogViewState, b: LogBuffer, h: number, ...types: LogViewAction["type"][]): LogViewState {
  return types.reduce((s, type) => reduceLogView(s, { type } as LogViewAction, b, h), v);
}

describe("logWindow", () => {
  test("follow shows the newest lines", () => {
    const b = filled(10);
    expect(shown(FOLLOW, b, 3)).toEqual(["l7", "l8", "l9"]);
    expect(logWindow(FOLLOW, b, 3)).toMatchObject({ below: 0, above: 7 });
  });

  test("fewer lines than rows: everything, top-aligned", () => {
    const b = filled(2);
    expect(shown(FOLLOW, b, 5)).toEqual(["l0", "l1"]);
    expect(shown({ mode: "scrolled", bottom: 0 }, b, 5)).toEqual(["l0", "l1"]);
  });

  test("empty buffer and zero height", () => {
    expect(logWindow(FOLLOW, filled(0), 5)).toEqual({ lines: [], below: 0, above: 0 });
    expect(logWindow(FOLLOW, filled(5), 0).lines).toEqual([]);
  });
});

describe("reduceLogView", () => {
  test("scrolling up leaves follow; new lines are counted below, not shown", () => {
    const b = filled(10);
    const v = run(FOLLOW, b, 3, "lineUp");
    expect(v.mode).toBe("scrolled");
    expect(shown(v, b, 3)).toEqual(["l6", "l7", "l8"]);
    add(b, 4);
    expect(shown(v, b, 3)).toEqual(["l6", "l7", "l8"]);
    expect(logWindow(v, b, 3).below).toBe(5);
  });

  test("scrolling back down to the end resumes follow", () => {
    const b = filled(10);
    const v = run(FOLLOW, b, 3, "lineUp", "lineUp", "lineDown", "lineDown");
    expect(v).toEqual(FOLLOW);
  });

  test("pause freezes the view; resume catches up to the newest line", () => {
    const b = filled(10);
    const paused = run(FOLLOW, b, 3, "togglePause");
    expect(paused.mode).toBe("paused");
    add(b, 20);
    expect(shown(paused, b, 3)).toEqual(["l7", "l8", "l9"]);
    expect(logWindow(paused, b, 3).below).toBe(20);
    const resumed = run(paused, b, 3, "togglePause");
    expect(resumed).toEqual(FOLLOW);
    expect(shown(resumed, b, 3)).toEqual(["l27", "l28", "l29"]);
  });

  test("scrolling while paused stays paused, even at the bottom", () => {
    const b = filled(10);
    const v = run(FOLLOW, b, 3, "togglePause", "lineUp", "lineDown", "lineDown");
    expect(v.mode).toBe("paused");
  });

  test("pages move by height-1 and clamp at the top", () => {
    const b = filled(20);
    const v = run(FOLLOW, b, 5, "pageUp");
    expect(shown(v, b, 5)).toEqual(["l11", "l12", "l13", "l14", "l15"]);
    const top = run(v, b, 5, "pageUp", "pageUp", "pageUp", "pageUp");
    expect(shown(top, b, 5)).toEqual(["l0", "l1", "l2", "l3", "l4"]);
  });

  test("g goes to the oldest line, G back to live follow (also from pause)", () => {
    const b = filled(20);
    const g = run(FOLLOW, b, 4, "top");
    expect(shown(g, b, 4)).toEqual(["l0", "l1", "l2", "l3"]);
    expect(run(g, b, 4, "togglePause", "bottom")).toEqual(FOLLOW);
  });

  test("g on short content stays in follow", () => {
    const b = filled(2);
    expect(run(FOLLOW, b, 5, "top")).toEqual(FOLLOW);
  });

  test("a scrolled view survives the ring dropping lines under it", () => {
    const b = filled(10, 10);
    const v = run(FOLLOW, b, 3, "top"); // l0..l2
    add(b, 5); // drops l0..l4
    expect(shown(v, b, 3)).toEqual(["l5", "l6", "l7"]);
    expect(logWindow(v, b, 3).above).toBe(0);
  });

  test("reset returns to follow", () => {
    const b = filled(10);
    expect(run(FOLLOW, b, 3, "togglePause", "reset")).toEqual(FOLLOW);
  });
});
