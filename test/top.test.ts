/**
 * Top tab (P3-T8): table built from the recorded `top` response, aligned by
 * column title, durations shortened, header kept while scrolling.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ContainerTop } from "../src/api/types.ts";
import { shortDuration, topTable } from "../src/ui/view/topView.ts";
import { buildFrameModel, EMPTY_DATA } from "../src/ui/view/build.ts";
import { renderDetail } from "../src/ui/render/detailLines.ts";
import { stripAnsi } from "../src/ui/render/palette.ts";
import { displayWidth } from "../src/util/fit.ts";
import { defaultTheme } from "../src/theme/theme.ts";
import { PANEL_IDS, type PanelId } from "../src/ui/layout/types.ts";

const top = JSON.parse(readFileSync("test/fixtures/container-top.json", "utf8")) as ContainerTop;
const containers = JSON.parse(readFileSync("test/fixtures/containers-list.json", "utf8"));

describe("topTable", () => {
  test("Go durations lose their nanoseconds", () => {
    expect(shortDuration("1h1m21.409957373s")).toBe("1h1m21s");
    expect(shortDuration("2.22034985s")).toBe("2s");
    expect(shortDuration("0s")).toBe("0s");
  });

  test("fixture: header plus one aligned row per process", () => {
    const t = topTable(top);
    expect(t.processes).toBe(9);
    expect(t.lines[0]).toBe("USER   PID  PPID   %CPU  ELAPSED  TTY  TIME  COMMAND");
    expect(t.lines[1]).toBe("root     1     0  0.000  1h1m21s  ?    0s    nginx: master process nginx -g daemon off;");
    expect(t.lines[2]).toBe("nginx   30     1  0.000  1h1m21s  ?    0s    nginx: worker process");
    // Every row starts COMMAND at the same column.
    const at = t.lines[0]!.indexOf("COMMAND");
    for (const line of t.lines.slice(1)) expect(line.slice(at, at + 5)).toMatch(/^nginx/);
  });

  test("columns are found by title: a reordered response still aligns", () => {
    const t = topTable({ Titles: ["COMMAND", "PID"].reverse(), Processes: [["7", "sh"], ["12345", "sleep 2"]] });
    expect(t.lines).toEqual(["  PID  COMMAND", "    7  sh", "12345  sleep 2"]);
  });

  test("an empty process list is just the header", () => {
    expect(topTable({ Titles: ["PID", "COMMAND"], Processes: [] }).lines).toEqual(["PID  COMMAND"]);
  });
});

describe("Top tab model and render", () => {
  const selected = Object.fromEntries(PANEL_IDS.map((p) => [p, ""])) as Record<PanelId, string>;
  const model = (topArg: Parameters<typeof buildFrameModel>[0]["top"]) =>
    buildFrameModel({
      data: { ...EMPTY_DATA, containers },
      selected: { ...selected, containers: containers[0].Id },
      focus: "containers",
      now: Date.now(),
      clock: "",
      activeTab: "top",
      top: topArg,
    }).detail;

  test("running: the table, flagged with a sticky header, and a process count", () => {
    const d = model({ status: { kind: "ok", top, at: 0 }, state: "running", name: "web" });
    expect(d.table).toBe(true);
    expect(d.lines[0]).toContain("COMMAND");
    expect(d.hint).toBe("9 processes · every 2 s");
  });

  test("stopped, loading and error states", () => {
    expect(model({ status: { kind: "idle" }, state: "exited", name: "failing" }).lines[0]).toBe("failing is not running (exited).");
    expect(model({ status: { kind: "loading" }, state: "running", name: "web" }).lines).toEqual(["Loading processes…"]);
    expect(model({ status: { kind: "error", message: "top can only be used on running containers" }, state: "running", name: "web" }).lines[0]).toBe(
      "Processes unavailable: top can only be used on running containers",
    );
  });

  test("scrolling keeps the header row on screen", () => {
    const d = model({ status: { kind: "ok", top, at: 0 }, state: "running", name: "web" });
    const rect = { x: 0, y: 0, w: 60, h: 7 }; // 4 content rows: header + 3
    const out = renderDetail(rect, { ...d }, { theme: defaultTheme, color: true, scroll: 4 });
    for (const line of out) expect(displayWidth(line)).toBe(60);
    const rows = out.slice(2, -1).map((l) => stripAnsi(l).slice(1, -1));
    expect(rows[0]).toMatch(/^USER +PID/);
    expect(rows[1]).toMatch(/^nginx +33 /);
    expect(stripAnsi(out.at(-1) ?? "")).toContain("↓2 more");
  });
});
