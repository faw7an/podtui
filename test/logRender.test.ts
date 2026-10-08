/**
 * Logs tab rendering (P3-T2): windowing to the pane, exact widths, the
 * bottom-border status hint, empty/error states, the footer's logs context,
 * and text sanitizing so a log line can never break the frame.
 */

import { describe, expect, test } from "bun:test";
import stringWidth from "string-width";
import { renderDetail } from "../src/ui/render/detailLines.ts";
import { buildFooter } from "../src/ui/render/chrome.ts";
import { computeLayout } from "../src/ui/layout/computeLayout.ts";
import { PANEL_IDS, type PanelId } from "../src/ui/layout/types.ts";
import { PANEL_COLUMNS, panelMeta, type DetailLogModel, type FrameModel } from "../src/ui/view/model.ts";
import { KEYMAP } from "../src/ui/view/help.ts";
import { FOLLOW, type LogViewState } from "../src/ui/view/logView.ts";
import type { LogStreamStatus } from "../src/ui/view/logSession.ts";
import { LogBuffer } from "../src/util/logBuffer.ts";
import { sanitizeLogText } from "../src/util/logText.ts";
import { displayWidth } from "../src/util/fit.ts";
import { stripAnsi } from "../src/ui/render/palette.ts";
import { defaultTheme } from "../src/theme/theme.ts";

const RECT = { x: 0, y: 0, w: 40, h: 8 }; // 5 content rows
const T = new Date(0);

function buffer(lines: string[]): LogBuffer {
  const b = new LogBuffer();
  for (const l of lines) b.push({ stream: "stdout", timestamp: T, message: `${l}\n` });
  return b;
}

function render(log: DetailLogModel, color = false): string[] {
  return renderDetail(
    RECT,
    { title: "chatty · running", tabs: ["Logs", "Config"], activeTab: 0, lines: [], log },
    { theme: defaultTheme, color },
  );
}

const model = (
  b: LogBuffer,
  view: LogViewState = FOLLOW,
  status: LogStreamStatus = { kind: "live" },
): DetailLogModel => ({ source: b, view, status });

const content = (out: string[]): string[] => out.slice(2, -1).map((l) => stripAnsi(l).slice(1, -1).trimEnd());

describe("Logs tab render", () => {
  test("follow shows the newest lines that fit, every row exactly the pane width", () => {
    const b = buffer(Array.from({ length: 50 }, (_, i) => `line ${i}`));
    const out = render(model(b), true);
    expect(out).toHaveLength(RECT.h);
    for (const line of out) expect(displayWidth(line)).toBe(RECT.w);
    expect(content(out)).toEqual(["line 45", "line 46", "line 47", "line 48", "line 49"]);
  });

  test("paused with new lines below says so on the bottom border, right-aligned", () => {
    const b = buffer(Array.from({ length: 10 }, (_, i) => `l${i}`));
    const view: LogViewState = { mode: "paused", bottom: 10 };
    b.push({ stream: "stdout", timestamp: T, message: "c\n" });
    const bottom = stripAnsi(render(model(b, view)).at(-1) ?? "");
    expect(bottom).toMatch(/─ PAUSED · ↓1 new ┘$/);
  });

  test("an overlong error hint is cut, never pushes the corner out", () => {
    const b = buffer(["a"]);
    const out = render(model(b, FOLLOW, { kind: "error", message: "x".repeat(200) }));
    expect(displayWidth(out.at(-1) ?? "")).toBe(RECT.w);
    expect(out.at(-1)?.endsWith("┘")).toBe(true);
  });

  test.each([
    [{ kind: "connecting" }, "Connecting to the log stream…"],
    [{ kind: "live" }, "No log output yet."],
    [{ kind: "idle" }, "No log output yet."],
    [{ kind: "ended" }, "No log output; the stream has ended."],
    [{ kind: "error", message: "boom" }, "Logs unavailable: boom"],
  ] as [LogStreamStatus, string][])("empty buffer, status %p", (status, text) => {
    expect(content(render(model(new LogBuffer(), FOLLOW, status)))[0]).toBe(text);
  });

  test("hostile log text cannot break the frame", () => {
    const b = buffer([
      "\x1b[2J\x1b[Hclear screen",
      "tab\there",
      "progress 10%\rprogress 100%",
      "\x1b]0;title\x07osc",
      "宽字符宽字符宽字符宽字符宽字符宽字符宽字符",
    ]);
    const out = render(model(b), true);
    for (const line of out) expect(displayWidth(line)).toBe(RECT.w);
    const rows = content(out);
    expect(rows[0]).toBe("clear screen");
    expect(rows[1]).toBe("tab     here");
    expect(rows[2]).toBe("progress 10%progress 100%");
    expect(rows[3]).toBe("osc");
  });
});

describe("sanitizeLogText", () => {
  test.each([
    ["plain", "plain"],
    ["\x1b[31mred\x1b[0m", "red"],
    ["a\tb", "a       b"],
    ["1234567\tx", "1234567 x"],
    ["bell\x07", "bell"],
    ["nul\x00", "nul"],
    ["c1\u009b", "c1"],
    ["café ✓", "café ✓"],
  ])("%p → %p", (raw, clean) => {
    expect(sanitizeLogText(raw)).toBe(clean);
  });
});

describe("footer: logs context", () => {
  const ALL = new Set<PanelId>(PANEL_IDS);
  const frame = (log?: DetailLogModel): FrameModel => ({
    panels: PANEL_IDS.map((id) => ({ id, ...panelMeta(id), columns: PANEL_COLUMNS[id], items: [], selected: 0 })),
    focus: "detail",
    clock: "",
    detail: { title: "", tabs: [], activeTab: 0, lines: [], log },
  });
  const layout = computeLayout({ cols: 140, rows: 24, visible: ALL, focused: "detail", detailFullscreen: true });

  test("detail focus on the Logs tab advertises log keys", () => {
    const text = stripAnsi(buildFooter(layout, frame(model(new LogBuffer())), { theme: defaultTheme, color: false }));
    expect(text).toContain("↑↓jk scroll");
    expect(text).toContain("p pause");
    expect(text).toContain("g G top/live");
  });

  test("other tabs keep the detail hints", () => {
    const text = stripAnsi(buildFooter(layout, frame(), { theme: defaultTheme, color: false }));
    expect(text).toContain("↑↓jk next");
    expect(text).not.toContain("p pause");
  });

  test("every logs-context key exists in KEYMAP (R-17 no drift)", () => {
    const keys = new Set(KEYMAP.map((k) => k.key));
    for (const key of ["↑↓jk", "p", "g G", "[ ]", "Esc", "?", "q"]) expect(keys.has(key)).toBe(true);
  });
});

describe("string-width patch (patches/string-width@8.3.0.patch)", () => {
  // Ink measures every <Text> with `string-width`. Its pure-JS path made each
  // frame cost ~250 ms; the patch delegates to Bun.stringWidth. If a reinstall
  // drops the patch these fail before the UI becomes sluggish again.
  test("Ink's width function agrees with podtui's for frame glyphs", () => {
    for (const s of ["│▸ web ● running ─╮", "✖ exited", "◐ paused", "宽", "\x1b[31mred\x1b[0m", "👩‍👩‍👧‍👦"]) {
      expect(stringWidth(s)).toBe(Bun.stringWidth(s));
    }
  });

  test("is fast enough for a full frame", () => {
    const line = "│▸ web                             ● running nginx:alpine 9m  ││".repeat(2);
    const start = performance.now();
    for (let i = 0; i < 36 * 50; i++) stringWidth(line);
    // 50 frames of 36 lines. Unpatched this took seconds.
    expect(performance.now() - start).toBeLessThan(200);
  });
});
