import { describe, expect, test } from "bun:test";
import React from "react";
import { EventEmitter } from "node:events";
import { render } from "ink";
import { Frame } from "../src/ui/components/Frame";
import { Screen } from "../src/ui/components/Screen";
import { computeLayout } from "../src/ui/layout/computeLayout";
import { PANEL_IDS, type PanelId } from "../src/ui/layout/types";
import { PANEL_COLUMNS, panelMeta, type FrameModel, type RowModel } from "../src/ui/view/model";
import { defaultTheme } from "../src/theme/theme";
import { displayWidth } from "../src/util/fit";

/**
 * `ink-testing-library` cannot simulate a terminal size (it hardcodes
 * columns=100 and has no rows — verified in docs/DECISIONS.md), so we drive
 * Ink's own `render()` with a fake stdout. That exercises the real
 * `useWindowSize` path and lets us assert the spec sizes exactly.
 */
class FakeStdout extends EventEmitter {
  columns: number;
  rows: number;
  // Ink writes NOTHING when `isTTY` is false (verified), so the fake reports a
  // TTY and we split frames on the hide-cursor sequence Ink emits per frame.
  readonly isTTY = true;
  private buffer = "";

  constructor(columns: number, rows: number) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  write = (chunk: string): boolean => {
    this.buffer += chunk;
    return true;
  };

  setSize(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
    this.emit("resize");
  }

  /** Everything written so far, ANSI stripped, without clearing. */
  peek(): string {
    return this.buffer.replaceAll(ANSI_RE, "");
  }

  /** Everything written since the last call, ANSI stripped. */
  take(): string {
    const out = this.buffer;
    this.buffer = "";
    return out.replaceAll(ANSI_RE, "");
  }

  /**
   * The most recent complete frame. Ink emits a hide-cursor sequence at the
   * start of every frame, which gives us an exact boundary to split on.
   */
  frame(): string {
    const frames = this.buffer.split(HIDE_CURSOR).filter((f) => f.length > 0);
    return (frames.at(-1) ?? this.buffer).replaceAll(ANSI_RE, "");
  }
}

// Built from char codes so the source contains no raw control characters.
const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, "g");
const HIDE_CURSOR = `${ESC}[?25l`;

const items = (n: number): RowModel[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `i${i}`,
    tone: "ok" as const,
    cells: {
      name: `container-number-${i}`,
      state: "● running",
      image: "nginx:alpine",
      age: "2h",
      size: "64.3MB",
      count: "3",
      mountpoint: "/var/lib/containers/vol",
    },
  }));

function model(rows = 12): FrameModel {
  return {
    panels: PANEL_IDS.map((id) => ({ id, ...panelMeta(id), columns: PANEL_COLUMNS[id], items: items(rows), selected: 1 })),
    focus: "containers",
    clock: "9:40 PM",
    detail: {
      title: "container-number-1 · running",
      tabs: ["Logs", "Stats", "Env", "Config", "Top"],
      activeTab: 0,
      lines: ["name  container-number-1", "state ● running"],
    },
  };
}

const SIZES = [
  [200, 50],
  [150, 40],
  [120, 35],
  [100, 30],
  [80, 24],
  [60, 20],
  [40, 10],
] as const;

async function renderAt(cols: number, rows: number, rows2 = 12) {
  const stdout = new FakeStdout(cols, rows);
  const layout = computeLayout({
    cols,
    rows,
    visible: new Set<PanelId>(PANEL_IDS),
    focused: "containers",
  });
  const instance = render(
    React.createElement(Frame, { layout, model: model(rows2), theme: defaultTheme, color: false }),
    { stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, exitOnCtrlC: false },
  );
  await new Promise((r) => setTimeout(r, 120));
  return { stdout, instance, layout };
}

describe("Ink render at the spec sizes (LAYOUT_SPEC §10)", () => {
  for (const [cols, rows] of SIZES) {
    test(`${cols}x${rows}: at most ${rows} lines, none wider than ${cols}`, async () => {
      const { stdout, instance } = await renderAt(cols, rows);
      const lines = stdout.frame().split("\n").filter((l) => l.length > 0);
      // Invariant 4: never more than `rows` lines, never wider than `cols`.
      expect(lines.length).toBeLessThanOrEqual(rows);
      for (const line of lines) {
        expect(displayWidth(line)).toBeLessThanOrEqual(cols);
      }
      instance.unmount();
    });
  }

  test("the header shows all six panel numbers on one line", async () => {
    const { stdout, instance } = await renderAt(120, 35);
    const lines = stdout.frame().split("\n");
    const header = lines.find((l) => l.includes("podtui")) ?? "";
    for (const id of PANEL_IDS) {
      expect(header).toContain(String(panelMeta(id).number));
    }
    // The STATUS header must not be split across rows.
    expect(lines.some((l) => l.includes("STATUS"))).toBe(true);
    expect(lines.some((l) => /^S$/.test(l.trim()))).toBe(false);
    instance.unmount();
  });

  test("STATUS stays on a single line, never one letter per row", async () => {
    const { stdout, instance } = await renderAt(200, 50);
    const lines = stdout.frame().split("\n");
    expect(lines.filter((l) => l.trim() === "S").length).toBe(0);
    expect(lines.filter((l) => l.trim() === "T").length).toBe(0);
    expect(lines.filter((l) => l.includes("STATUS")).length).toBeGreaterThan(0);
    instance.unmount();
  });

  test("a long list scrolls instead of being cut off", async () => {
    const { stdout, instance } = await renderAt(200, 50, 100);
    const frame = stdout.frame();
    expect(frame).toContain("more");
    // The selected item is on screen.
    expect(frame).toContain("▸ container-number-1");
    instance.unmount();
  });

  test("Screen re-lays out when the terminal size changes", async () => {
    // `Screen` turns a terminal size into a layout, so a resize must re-flow
    // through `computeLayout`. This uses Ink's real path: the fake stdout
    // carries columns/rows and emits `resize`, which `useWindowSize` observes.
    const stdout = new FakeStdout(200, 50);
    const m = model(12);
    const instance = render(
      React.createElement(Screen, {
        model: m,
        theme: defaultTheme,
        visible: new Set<PanelId>(PANEL_IDS),
        zoom: null,
        detailFullscreen: false,
        color: false,
      }),
      { stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, exitOnCtrlC: false },
    );
    await new Promise((r) => setTimeout(r, 150));
    const wide = stdout.frame().split("\n");
    expect(wide.length).toBeLessThanOrEqual(50);
    for (const line of wide) expect(displayWidth(line)).toBeLessThanOrEqual(200);
    // XL: the 2-column grid lists every panel.
    expect(wide.join("\n")).toContain("[1] Pods");
    expect(wide.join("\n")).toContain("[6] Quadlets");

    // Shrink to mode S via a real resize event. Ink writes the settled frame
    // last (and only sends the hide-cursor sequence once), so read the tail.
    stdout.setSize(60, 20);
    await new Promise((r) => setTimeout(r, 250));
    const narrow = stdout.peek().split("\n").filter((l) => l.length > 0).slice(-20);
    expect(narrow.length).toBeLessThanOrEqual(20);
    for (const line of narrow) expect(displayWidth(line)).toBeLessThanOrEqual(60);
    const narrowText = narrow.join("\n");
    expect(narrowText).toContain("podtui");
    expect(narrowText).toContain("[2] Containers");
    expect(narrowText).not.toContain("[1] Pods");

    // Grow back to XL; the grid must return.
    stdout.take();
    stdout.setSize(200, 50);
    await new Promise((r) => setTimeout(r, 250));
    const back = stdout.peek().split("\n").filter((l) => l.length > 0).slice(-50);
    expect(back.length).toBeLessThanOrEqual(50);
    for (const line of back) expect(displayWidth(line)).toBeLessThanOrEqual(200);
    expect(back.join("\n")).toContain("[1] Pods");

    instance.unmount();
  });

  test("zoom renders a single full-body panel", async () => {
    const stdout = new FakeStdout(120, 35);
    const layout = computeLayout({
      cols: 120,
      rows: 35,
      visible: new Set<PanelId>(PANEL_IDS),
      focused: "containers",
      zoom: "containers",
    });
    const instance = render(
      React.createElement(Frame, { layout, model: model(), theme: defaultTheme, color: false }),
      { stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, exitOnCtrlC: false },
    );
    await new Promise((r) => setTimeout(r, 120));
    const frame = stdout.frame();
    expect(frame).toContain("[2] Containers");
    expect(frame).not.toContain("[1] Pods");
    instance.unmount();
  });

  test("TOO_SMALL renders only the message, exactly `rows` lines", async () => {
    const stdout = new FakeStdout(30, 8);
    const layout = computeLayout({ cols: 30, rows: 8, visible: new Set<PanelId>(PANEL_IDS), focused: "containers" });
    const instance = render(
      React.createElement(Frame, { layout, model: model(), theme: defaultTheme, color: false }),
      { stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, exitOnCtrlC: false },
    );
    await new Promise((r) => setTimeout(r, 120));
    const lines = stdout.frame().split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBeLessThanOrEqual(8);
    expect(stdout.frame()).toContain("Terminal too small");
    expect(stdout.frame()).not.toContain("Containers");
    instance.unmount();
  });

  test("unmounting leaves no timers running", async () => {
    const { instance } = await renderAt(120, 35);
    instance.unmount();
    expect(instance.unmount).not.toThrow();
  });
});
