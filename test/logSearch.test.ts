/**
 * Logs tab search, highlight, wrap and the errors-only view (P3-T4, P3-T5).
 */

import { describe, expect, test } from "bun:test";
import { LogBuffer, type LogLine } from "../src/util/logBuffer.ts";
import { findMatch, lineMatches, matchCount, matchRanges } from "../src/ui/view/logSearch.ts";
import { FOLLOW, logWindow, reduceLogView } from "../src/ui/view/logView.ts";
import { renderLogRows } from "../src/ui/render/logRows.ts";
import { errorsOnly } from "../src/ui/render/detailLines.ts";
import { bg, bold, dim, fg, RESET } from "../src/ui/render/palette.ts";
import { defaultTheme as theme } from "../src/theme/theme.ts";

const T = new Date(2026, 9, 8, 9, 46, 7);

function buf(lines: string[]): LogBuffer {
  const b = new LogBuffer();
  for (const l of lines) b.push({ stream: "stdout", timestamp: T, message: `${l}\n` });
  return b;
}
const one = (text: string): LogLine => buf([text]).at(0) as LogLine;

describe("search matching", () => {
  test("literal, case-insensitive, over the visible text", () => {
    expect(lineMatches(one("Connection RESET by peer"), "reset")).toBe(true);
    expect(lineMatches(one("a.b"), ".")).toBe(true);
    expect(lineMatches(one("abc"), "a.c")).toBe(false);
    // Container ANSI is not searchable text.
    expect(lineMatches(one("\x1b[31mred\x1b[0m"), "31m")).toBe(false);
    expect(lineMatches(one("x"), "")).toBe(false);
  });

  test("matchRanges finds every non-overlapping occurrence", () => {
    expect(matchRanges("aXaXa", "x")).toEqual([[1, 2], [3, 4]]);
    expect(matchRanges("aaaa", "aa")).toEqual([[0, 2], [2, 4]]);
    expect(matchRanges("abc", "")).toEqual([]);
  });

  test("n starts at the newest match, then walks forward and wraps", () => {
    const b = buf(["boom 0", "ok", "boom 2", "ok", "boom 4"]);
    const first = findMatch(b, "boom", null, 1);
    expect(first).toBe(4);
    expect(findMatch(b, "boom", 4, 1)).toBe(0); // wraps
    expect(findMatch(b, "boom", 0, 1)).toBe(2);
    expect(findMatch(b, "boom", 2, -1)).toBe(0);
    expect(findMatch(b, "boom", 0, -1)).toBe(4); // wraps backwards
    expect(findMatch(b, "nothing", null, 1)).toBeNull();
  });

  test("search respects the errors-only filter", () => {
    const b = buf(["boom info", "ERROR boom", "boom again"]);
    expect(findMatch(b, "boom", null, 1, errorsOnly)).toBe(1);
    expect(matchCount(b, "boom", 1, errorsOnly)).toEqual({ total: 1, index: 1 });
    expect(matchCount(b, "boom", null)).toEqual({ total: 3, index: null });
  });
});

describe("errors-only view", () => {
  const b = buf(["a", "ERROR 1", "b", "c", "ERROR 2", "d", "ERROR 3"]);

  test("the window shows only error lines, counted as such", () => {
    const w = logWindow(FOLLOW, b, 2, errorsOnly);
    expect(w.lines.map((l) => l.text)).toEqual(["ERROR 2", "ERROR 3"]);
    expect(w.above).toBe(1);
    expect(w.below).toBe(0);
  });

  test("scrolling moves by visible lines", () => {
    const v = reduceLogView(FOLLOW, { type: "lineUp" }, b, 2, errorsOnly);
    expect(logWindow(v, b, 2, errorsOnly).lines.map((l) => l.text)).toEqual(["ERROR 1", "ERROR 2"]);
    expect(logWindow(v, b, 2, errorsOnly).below).toBe(1);
  });

  test("the anchor is a real sequence, so turning the filter off keeps the place", () => {
    const v = reduceLogView(FOLLOW, { type: "lineUp" }, b, 2, errorsOnly);
    // Bottom is just after "ERROR 2" (seq 4): unfiltered, the last two lines
    // before it are "c" and "ERROR 2".
    expect(logWindow(v, b, 2).lines.map((l) => l.text)).toEqual(["c", "ERROR 2"]);
  });

  test("reveal centres a line off-screen and leaves an on-screen one alone", () => {
    const many = buf(Array.from({ length: 30 }, (_, i) => `l${i}`));
    const v = reduceLogView(FOLLOW, { type: "reveal", seq: 5 }, many, 5);
    expect(v.mode).toBe("scrolled");
    expect(logWindow(v, many, 5).lines.map((l) => l.text)).toEqual(["l3", "l4", "l5", "l6", "l7"]);
    expect(reduceLogView(v, { type: "reveal", seq: 6 }, many, 5)).toBe(v);
  });
});

describe("renderLogRows", () => {
  test("highlights matches in the body, never in the timestamp", () => {
    const rows = renderLogRows(one("2026 crash 2026"), { theme, color: true, timestamps: true, query: "2026" });
    const hl = `${bg(theme.warn)}${fg(theme.selectionFg)}2026${RESET}`;
    expect(rows).toEqual([`${dim()}2026-10-08 09:46:07 ${RESET}${hl} crash ${hl}`]);
  });

  test("the current match is highlighted more strongly; level colour resumes after it", () => {
    const rows = renderLogRows(one("ERROR boom here"), { theme, color: true, query: "boom", current: true });
    expect(rows[0]).toBe(
      `${fg(theme.error)}ERROR ${RESET}${bg(theme.accent)}${fg(theme.selectionFg)}${bold()}boom${RESET}${fg(theme.error)} here${RESET}`,
    );
  });

  test("wrap splits by display cells, keeps wide glyphs whole, and every row resets", () => {
    const rows = renderLogRows(one("ab宽cd"), { theme, color: false, wrapWidth: 3 });
    expect(rows).toEqual(["ab", "宽c", "d"]);
    const red = renderLogRows(one("ERROR xxxxxxxxxx"), { theme, color: true, wrapWidth: 6 });
    expect(red.length).toBe(3);
    for (const r of red) expect(r.endsWith(RESET)).toBe(true);
  });

  test("a highlight that crosses a row break is highlighted on both rows", () => {
    const rows = renderLogRows(one("abcdef"), { theme, color: true, query: "cd", wrapWidth: 3 });
    expect(rows[0]).toContain(`${bg(theme.warn)}${fg(theme.selectionFg)}c${RESET}`);
    expect(rows[1]).toContain(`${bg(theme.warn)}${fg(theme.selectionFg)}d${RESET}`);
  });

  test("without wrap there is exactly one row", () => {
    expect(renderLogRows(one("x".repeat(500)), { theme, color: false })).toHaveLength(1);
  });
});
