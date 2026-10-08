import { createVisibleFetcher } from "../src/ui/view/refresh.ts";
import { test, expect, describe } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createPodmanEngine } from "../src/engine/podman.ts";
import type { PrunePreview, PruneResult } from "../src/engine/ContainerEngine.ts";
import {
  buildFrameModel,
  buildPanelModels,
  EMPTY_DATA,
  type ResourceData,
} from "../src/ui/view/build";
import { PANEL_IDS, type PanelId } from "../src/ui/layout/types";
import type {
  ContainerListItem,
  ContainerStatsUI,
  ImageListItem,
  NetworkListItem,
  PodListItem,
  VolumeListItem,
} from "../src/api/types";

/**
 * Behavioural tests for the engine boundary and the engine -> UI mapping.
 *
 * The previous version of this file asserted type literals and defined its own
 * lambda instead of calling the implementation: with `isSandboxSocket` mutated
 * to `return true`, all 5 of its tests still passed. Every test here calls real
 * code.
 */

const FIXTURE_DIR = path.join(import.meta.dirname, "fixtures");

function readFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf-8")) as T;
}

const engine = createPodmanEngine();

function noSelection(): Record<PanelId, string> {
  return Object.fromEntries(PANEL_IDS.map((id) => [id, ""])) as Record<PanelId, string>;
}

describe("engine: destructive guard", () => {
  test("accepts the sandbox and test socket paths", () => {
    expect(engine.isSandboxSocket("/tmp/podtui-dev/podman.sock")).toBe(true);
    expect(engine.isSandboxSocket("/tmp/podtui-test/podman.sock")).toBe(true);
    expect(engine.isSandboxSocket("/tmp/podtui-dev/nested/podman.sock")).toBe(true);
  });

  test("rejects production sockets", () => {
    expect(engine.isSandboxSocket("/run/user/1000/podman/podman.sock")).toBe(false);
    expect(engine.isSandboxSocket("/run/podman/podman.sock")).toBe(false);
    expect(engine.isSandboxSocket("/var/run/podman/podman.sock")).toBe(false);
    expect(engine.isSandboxSocket("/custom/path.sock")).toBe(false);
    expect(engine.isSandboxSocket("")).toBe(false);
  });

  test("rejects a path that only CONTAINS a sandbox segment", () => {
    // A naive `includes("/tmp/podtui-dev/")` would wrongly allow this one.
    expect(engine.isSandboxSocket("/etc/tmp/podtui-dev/podman.sock")).toBe(false);
    expect(engine.isSandboxSocket("/tmp/podtui-dev-evil/podman.sock")).toBe(false);
  });
});

describe("engine: no-id paths never touch the socket", () => {
  test("containerStats with no ids resolves to an empty result", async () => {
    // An unroutable socket proves no request is attempted.
    const bogus = "/nonexistent/podman.sock";
    await expect(engine.containerStats(bogus, [], false)).resolves.toEqual([]);
  });

  test("containerStats streaming with no ids yields nothing", async () => {
    const bogus = "/nonexistent/podman.sock";
    const stream = await engine.containerStats(bogus, [], true);
    expect(Symbol.asyncIterator in Object(stream)).toBe(true);
    const seen: ContainerStatsUI[] = [];
    for await (const s of stream as AsyncGenerator<ContainerStatsUI>) seen.push(s);
    expect(seen).toHaveLength(0);
  });
});

describe("engine: fixture-driven resource mapping", () => {
  // These fixtures are the recorded sandbox responses that src/api/types.ts was
  // derived from, so they are read as the real API types.
  const containers = readFixture<ContainerListItem[]>("containers-list.json");
  const pods = readFixture<PodListItem[]>("pods-list.json");
  const images = readFixture<ImageListItem[]>("images-list.json");
  const volumes = readFixture<VolumeListItem[]>("volumes-list.json");
  const networks = readFixture<NetworkListItem[]>("networks-list.json");

  const data: ResourceData = { containers, pods, images, volumes, networks, danglingVolumes: null, quadlets: [] };
  const now = Date.parse("2026-10-03T00:00:00Z");

  test("every panel is produced, in canonical order", () => {
    const models = buildPanelModels(data, noSelection(), now);
    expect(models.map((m) => m.id)).toEqual([...PANEL_IDS]);
    for (const m of models) {
      expect(m.number).toBeGreaterThanOrEqual(1);
      expect(m.number).toBeLessThanOrEqual(6);
      expect(m.title.length).toBeGreaterThan(0);
    }
  });

  test("container rows map name, state and image from the fixture", () => {
    const c = buildPanelModels(data, noSelection(), now).find((m) => m.id === "containers");
    expect(c).toBeDefined();
    const first = c?.items[0];
    expect(first?.cells["name"]).toBe(containers[0]?.Names[0]?.replace(/^\//, ""));
    expect(first?.cells["state"]).toContain("running");
    // The docker.io/library/ prefix is stripped for display.
    expect(first?.cells["image"]).not.toContain("docker.io/library/");
  });

  test("status text carries a glyph as well as a colour (FR-5 / LAYOUT_SPEC §6)", () => {
    // Panels whose `state` cell is a real status must carry a glyph so meaning
    // survives NO_COLOR. Networks show the driver name, which is a label rather
    // than a status, so it is excluded.
    const STATUS_PANELS: PanelId[] = ["containers", "pods", "volumes", "quadlets"];
    const models = buildPanelModels(data, noSelection(), now);
    for (const m of models) {
      if (!STATUS_PANELS.includes(m.id)) continue;
      for (const item of m.items) {
        const state = item.cells["state"] ?? "";
        if (state.length === 0) continue;
        expect(state).toMatch(/^(●|◐|✖|○|·)\s/);
      }
    }
  });

  test("an exited container is reported with the error tone", () => {
    const exited: ResourceData = {
      ...data,
      containers: [{ ...containers[0], State: "exited" } as ContainerListItem],
    };
    const c = buildPanelModels(exited, noSelection(), now).find((m) => m.id === "containers");
    expect(c?.items[0]?.tone).toBe("error");
    expect(c?.items[0]?.cells["state"]).toContain("exited");
  });

  test("image size is formatted and age is derived from unix seconds", () => {
    const i = buildPanelModels(data, noSelection(), now).find((m) => m.id === "images");
    const first = i?.items[0];
    expect(first?.cells["size"]).toMatch(/^\d+(\.\d+)?(B|KB|MB|GB)$/);
    // The fixture's Created is unix seconds; an age must be produced, not "".
    expect((first?.cells["age"] ?? "").length).toBeGreaterThan(0);
  });

  test("pod rows expose the container count", () => {
    const p = buildPanelModels(data, noSelection(), now).find((m) => m.id === "pods");
    expect(p?.items[0]?.cells["count"]).toBe(String(pods[0]?.Containers.length ?? 0));
  });

  // Replaced 2026-10-08 (P4-T3). The old test pinned "MountCount > 0 means
  // in use", which is wrong on Podman 5.8.4: MountCount read 0 for a volume
  // mounted by a RUNNING container. "In use" now comes from the server's
  // dangling list, the rule `volume prune` follows (DECISIONS phase-4/P4-T3).
  test("a volume is 'in use' unless the server lists it as dangling; MountCount is ignored", () => {
    const name = volumes[0]!.Name;
    const rows = (d: ResourceData) => buildPanelModels(d, noSelection(), now).find((m) => m.id === "volumes")!;
    const unused = rows({ ...data, danglingVolumes: [name] });
    expect(unused.items[0]?.cells["state"]).toContain("unused");
    const inUse = rows({ ...data, danglingVolumes: [], volumes: [{ ...volumes[0], MountCount: 0 } as VolumeListItem] });
    expect(inUse.items[0]?.cells["state"]).toContain("in use");
    expect(inUse.items[0]?.tone).toBe("ok");
    // Before the dangling list arrives, the state is unknown, not "unused".
    expect(rows({ ...data, danglingVolumes: null }).items[0]?.cells["state"]).toContain("…");
  });

  test("refresh fetches the dangling list together with the volumes", async () => {
    const calls: string[] = [];
    const engine = {
      listContainers: async () => [],
      listPods: async () => [],
      listImages: async () => [],
      listVolumes: async () => (calls.push("list"), volumes),
      listNetworks: async () => [],
      danglingVolumeNames: async () => (calls.push("dangling"), [volumes[0]!.Name]),
    };
    const out = await createVisibleFetcher(engine, "/tmp/podtui-test/x.sock")(new Set(["volumes"]), EMPTY_DATA);
    expect(calls.sort()).toEqual(["dangling", "list"]);
    expect(out.data.danglingVolumes).toEqual([volumes[0]!.Name]);
  });

  test("network rows use the lowercase fields the API actually returns", () => {
    const n = buildPanelModels(data, noSelection(), now).find((m) => m.id === "networks");
    expect(n?.items[0]?.cells["name"]).toBe(networks[0]?.name);
    expect(n?.items[0]?.cells["state"]).toBe(networks[0]?.driver);
  });

  // Rewritten in Phase 6: the "not implemented (phase 6)" placeholder these
  // tests pinned is replaced by the real empty state (P6-T6).
  test("no quadlets: the panel says where they live", () => {
    const q = buildPanelModels(data, noSelection(), now).find((m) => m.id === "quadlets");
    expect(q?.items).toHaveLength(0);
    expect(q?.emptyLabel).toContain("~/.config/containers/systemd/");
    expect(q?.emptyLabel).toContain("/etc/containers/systemd/");
  });

  test("a reason for an empty list replaces the generic text", () => {
    const q = buildPanelModels({ ...data, quadletNote: "This Podman has no quadlet API" }, noSelection(), now).find((m) => m.id === "quadlets");
    expect(q?.emptyLabel).toBe("This Podman has no quadlet API");
  });

  test("a populated quadlet list drops the empty label and shows type and state", () => {
    const withQuadlets: ResourceData = {
      ...data,
      quadlets: [{ id: "hello.container", name: "hello.container", unit: "hello.service", type: "container", path: "/x", state: "active (running)", active: "active", load: "loaded" }],
    };
    const q = buildPanelModels(withQuadlets, noSelection(), now).find((m) => m.id === "quadlets");
    expect(q?.items).toHaveLength(1);
    expect(q?.emptyLabel).toBeUndefined();
    expect(q?.items[0]?.cells).toMatchObject({ type: "ctr", state: "● active (running)" });
    expect(q?.items[0]?.tone).toBe("ok");
  });

  test("selection is resolved from a stored item id", () => {
    const selected = { ...noSelection(), containers: containers[1]?.Id ?? "" };
    const c = buildPanelModels(data, selected, now).find((m) => m.id === "containers");
    expect(c?.selected).toBe(1);
    expect(c?.items[1]?.id).toBe(containers[1]?.Id);
  });

  test("an unknown selection id falls back to the first row", () => {
    const selected = { ...noSelection(), containers: "does-not-exist" };
    const c = buildPanelModels(data, selected, now).find((m) => m.id === "containers");
    expect(c?.selected).toBe(0);
  });

  test("empty resource lists produce empty panels, not crashes", () => {
    const models = buildPanelModels(EMPTY_DATA, noSelection(), now);
    for (const m of models) expect(m.items).toHaveLength(0);
  });
});

describe("engine -> frame model", () => {
  const data: ResourceData = {
    containers: readFixture("containers-list.json"),
    pods: readFixture("pods-list.json"),
    images: readFixture("images-list.json"),
    volumes: readFixture("volumes-list.json"),
    networks: readFixture("networks-list.json"),
    danglingVolumes: null,
    quadlets: [],
  };

  test("the detail pane describes the selected item", () => {
    const selected = { ...noSelection(), containers: data.containers[0]?.Id ?? "" };
    const model = buildFrameModel({
      data,
      selected,
      focus: "containers",
      now: 0,
      clock: "12:00",
    });
    expect(model.detail.title).not.toBe("(no selection)");
    // name and state both reach the detail lines
    expect(model.detail.lines.join("\n")).toContain("name");
    expect(model.detail.lines.join("\n")).toContain("state");
    expect(model.detail.tabs.length).toBeGreaterThan(1);
  });

  test("with no stored selection the first row is the effective selection", () => {
    // An empty selection id resolves to row 0 (there must always be a visible
    // cursor), so the detail pane describes that row rather than a placeholder.
    const model = buildFrameModel({ data, selected: noSelection(), focus: "containers", now: 0, clock: "" });
    expect(model.detail.title).not.toBe("(no selection)");
    expect(model.detail.title).toContain(data.containers[0]?.Names[0]?.replace(/^\//, "") ?? "");
  });

  test("with no items at all the detail pane shows the placeholder", () => {
    const model = buildFrameModel({
      data: EMPTY_DATA,
      selected: noSelection(),
      focus: "containers",
      now: 0,
      clock: "",
    });
    expect(model.detail.title).toBe("(no selection)");
    expect(model.detail.lines).toContain("no selection");
  });

  test("focus on detail still resolves a concrete item", () => {
    const selected = { ...noSelection(), containers: data.containers[0]?.Id ?? "" };
    const model = buildFrameModel({ data, selected, focus: "detail", now: 0, clock: "" });
    expect(model.focus).toBe("detail");
    expect(model.detail.title).not.toBe("(no selection)");
  });
});

describe("prune result shapes", () => {
  test("PrunePreview and PruneResult describe counts, names and reclaimed bytes", () => {
    const preview: PrunePreview = { containers: { count: 2, names: ["a", "b"] } };
    expect(preview.containers?.count).toBe(2);
    const result: PruneResult = {
      containers: { count: 2, names: ["a", "b"], reclaimedBytes: 1024 },
    };
    expect(result.containers?.reclaimedBytes).toBe(1024);
  });
});