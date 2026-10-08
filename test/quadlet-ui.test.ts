/**
 * Quadlets in the UI layer (P6-T1..T6): refresh with unit states, empty and
 * failure notes, actions and their confirm rule, the jump to the container,
 * the File/Unit views and the journal's priority colouring.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { QuadletListItem } from "../src/api/types.ts";
import { createVisibleFetcher } from "../src/ui/view/refresh.ts";
import { EMPTY_DATA, type QuadletData, type ResourceData } from "../src/ui/view/build.ts";
import { actionFor, quadletJumpTarget } from "../src/ui/actions/selectionAction.ts";
import { runAction } from "../src/ui/actions/resourceActions.ts";
import { quadletView } from "../src/ui/view/resourceDetail.ts";
import { journalSource } from "../src/ui/view/logSession.ts";
import { parseSystemctlShow, type JournalEntry } from "../src/engine/systemd.ts";

const list = JSON.parse(readFileSync("test/fixtures/quadlets-list.json", "utf8")) as QuadletListItem[];

function listEngine(quadlets: () => Promise<QuadletListItem[]>) {
  return {
    listContainers: async () => [],
    listPods: async () => [],
    listImages: async () => [],
    listVolumes: async () => [],
    listNetworks: async () => [],
    danglingVolumeNames: async () => [],
    listQuadlets: quadlets,
  };
}

describe("quadlet refresh", () => {
  test("Podman's list + one batched state query; states come from systemd", async () => {
    const asked: string[][] = [];
    const states = async (units: string[]) => {
      asked.push(units);
      return parseSystemctlShow("Id=hello.service\nLoadState=loaded\nActiveState=active\nSubState=running\n");
    };
    const out = await createVisibleFetcher(listEngine(async () => list), "/tmp/podtui-test/x.sock", states)(new Set(["quadlets"]), EMPTY_DATA);
    expect(asked).toEqual([list.map((q) => q.UnitName)]);
    const hello = out.data.quadlets.find((q) => q.id === "hello.container")!;
    expect(hello).toMatchObject({ unit: "hello.service", type: "container", state: "active (running)", active: "active" });
    // Not in systemd's answer: falls back to Podman's own status text.
    expect(out.data.quadlets.find((q) => q.id === "data.volume")?.state).toBe("not loaded");
    expect(out.data.quadletNote).toBeNull();
  });

  test("no quadlets: no systemctl call at all", async () => {
    let called = false;
    await createVisibleFetcher(listEngine(async () => []), "/x", async () => ((called = true), new Map()))(new Set(["quadlets"]), EMPTY_DATA);
    expect(called).toBe(false);
  });

  test("an old Podman (404) and a missing systemd session each explain themselves", async () => {
    const no404 = await createVisibleFetcher(listEngine(async () => Promise.reject(new Error("HTTP 404: not found"))), "/x")(new Set(["quadlets"]), EMPTY_DATA);
    expect(no404.data.quadletNote).toContain("no quadlet API");
    const noSystemd = await createVisibleFetcher(listEngine(async () => list), "/x", async () => Promise.reject(new Error("Failed to connect to bus")))(
      new Set(["quadlets"]),
      EMPTY_DATA,
    );
    expect(noSystemd.data.quadletNote).toContain("systemd did not answer (Failed to connect to bus)");
    expect(noSystemd.data.quadlets).toHaveLength(list.length);
  });

  test("hidden panel: nothing fetched", async () => {
    let called = false;
    await createVisibleFetcher(listEngine(async () => ((called = true), [])), "/x")(new Set(["containers"]), EMPTY_DATA);
    expect(called).toBe(false);
  });
});

const q = (over: Partial<QuadletData> = {}): QuadletData => ({
  id: "hello.container",
  name: "hello.container",
  unit: "hello.service",
  type: "container",
  path: "/x",
  state: "active (running)",
  active: "active",
  load: "loaded",
  ...over,
});
const withQ = (item: QuadletData): ResourceData => ({ ...EMPTY_DATA, quadlets: [item] });

describe("quadlet actions (P6-T4)", () => {
  test("start runs at once; stop/restart of a RUNNING unit asks first", () => {
    expect(actionFor("quadlets", "hello.container", "start", withQ(q({ active: "inactive" })), "hello.container")).toEqual({
      kind: "run",
      action: { kind: "quadlet", verb: "start", id: "hello.service", name: "hello.container" },
    });
    const stop = actionFor("quadlets", "hello.container", "stop", withQ(q()), "hello.container");
    expect(stop.kind).toBe("confirm");
    if (stop.kind === "confirm") expect(stop.content.lines[0]).toBe("Stop hello.service (from hello.container).");
    expect(actionFor("quadlets", "hello.container", "restart", withQ(q()), "x").kind).toBe("confirm");
  });

  test("stopping an inactive unit does not ask", () => {
    expect(actionFor("quadlets", "hello.container", "stop", withQ(q({ active: "inactive" })), "x").kind).toBe("run");
  });

  test("remove and kill are refused with the quadlet keys", () => {
    const r = actionFor("quadlets", "hello.container", "remove", withQ(q()), "x");
    expect(r).toEqual({ kind: "refuse", message: "Quadlets: s start, S stop, r restart the unit; R reloads systemd." });
  });

  test("runAction drives systemd with the UNIT name", async () => {
    const calls: string[] = [];
    const systemd = { action: async (verb: string, unit: string) => void calls.push(`${verb} ${unit}`) };
    await runAction({} as never, "/x", { kind: "quadlet", verb: "restart", id: "hello.service", name: "hello.container" }, systemd);
    expect(calls).toEqual(["restart hello.service"]);
  });
});

describe("jump to the container (P6-T5)", () => {
  const data = (names: string[], state = "running"): ResourceData => ({
    ...EMPTY_DATA,
    containers: names.map((n, i) => ({ Id: `id${i}`, Names: [n], State: state }) as never),
  });

  test("systemd-<unit> by default; ContainerName= when set", () => {
    expect(quadletJumpTarget(q(), "[Container]\nImage=x\n", data(["systemd-hello"]))).toEqual({
      kind: "jump",
      id: "id0",
      message: "hello.container: container systemd-hello (running)",
    });
    expect(quadletJumpTarget(q(), "[Container]\nContainerName=box\n", data(["box"]))).toMatchObject({ kind: "jump", id: "id0" });
  });

  test("a stopped unit has no container (--rm); non-container quadlets have none", () => {
    expect(quadletJumpTarget(q(), "[Container]\n", data([]))).toEqual({
      kind: "none",
      message: "No container systemd-hello right now: start the unit with s.",
    });
    expect(quadletJumpTarget(q({ name: "data.volume", unit: "data-volume.service" }), "", data([])).kind).toBe("none");
  });
});

describe("File and Unit tabs (P6-T3)", () => {
  const d = { panel: "quadlets" as const, id: "hello.container", unit: "hello.service", file: "[Container]\nImage=x\n", unitText: { cat: "# /run/x/hello.service\n[Unit]\n", status: "○ hello.service\n" } };

  test("File shows the quadlet as written, coloured as a systemd file", () => {
    expect(quadletView("file", d)).toEqual({ lines: ["[Container]", "Image=x"], ini: true, hint: "hello.service" });
  });

  test("Unit shows status, then the generated unit", () => {
    expect(quadletView("unit", d).lines).toEqual(["── Status ──", "○ hello.service", "── Generated unit ──", "# /run/x/hello.service", "[Unit]"]);
    expect(quadletView("unit", { ...d, unitText: null }).lines).toEqual(["Loading unit…"]);
  });
});

describe("Journal tab source (P6-T3)", () => {
  test("journald priority sets the level: ≤3 error, 4 warn, else from text", async () => {
    const entries: JournalEntry[] = [3, 4, 6].map((p) => ({ timestamp: new Date(0), message: `p${p}`, priority: p }));
    const systemd = {
      async *journal() {
        for (const e of entries) yield e;
      },
    };
    const out = [];
    for await (const line of journalSource(systemd, "hello.service")(new AbortController().signal, 10)) out.push(line);
    expect(out.map((l) => [l.message, l.level])).toEqual([
      ["p3\n", "error"],
      ["p4\n", "warn"],
      ["p6\n", undefined],
    ]);
  });
});
