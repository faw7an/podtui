/**
 * The `x` bulk menu (P5): command table against a mock engine, the flow's
 * guard rails, and what each screen says.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ContainerListItem } from "../src/api/types.ts";
import type { PrunePreview, PruneResult } from "../src/engine/ContainerEngine.ts";
import { mapPruneReports } from "../src/engine/podman.ts";
import { BULK_COMMANDS, orderedCommands, type BulkCommand, type BulkEngine } from "../src/ui/bulk/commands.ts";
import { HIGH_RISK_WORD, bulkKey, executed, openBulk, previewed, type BulkFlow } from "../src/ui/bulk/bulkFlow.ts";
import { bulkContent, bulkRect, nameList, renderBulk, resultSummary } from "../src/ui/render/bulkMenu.ts";
import { displayWidth } from "../src/util/fit.ts";
import { defaultTheme } from "../src/theme/theme.ts";

const containers = JSON.parse(readFileSync("test/fixtures/containers-list.json", "utf8")) as ContainerListItem[];
const pruneReports = JSON.parse(readFileSync("test/fixtures/prune-reports.json", "utf8"));
const cmd = (id: string): BulkCommand => BULK_COMMANDS.find((c) => c.id === id)!;

function mockEngine(opts: { failStop?: string } = {}) {
  const calls: string[] = [];
  const engine: BulkEngine = {
    listContainers: async () => containers,
    stopContainer: async (_s, id) => {
      calls.push(`stop ${id.slice(0, 12)}`);
      if (id === opts.failStop) throw new Error("timed out");
      return { success: true };
    },
    removeContainer: async (_s, id, force) => {
      calls.push(`rm ${id.slice(0, 12)} force=${force}`);
      return { success: true };
    },
    pruneContainers: async (_s, dry) => {
      calls.push(`pruneContainers dry=${dry}`);
      return dry
        ? ({ containers: { count: 1, names: ["failing"] } } as PrunePreview)
        : ({ containers: mapPruneReports(pruneReports.containers) } as PruneResult);
    },
    pruneImages: async (_s, dry) => (calls.push(`pruneImages dry=${dry}`), dry ? { images: { count: 0, names: [] } } : { images: mapPruneReports([]) }),
    pruneVolumes: async (_s, dry) => {
      calls.push(`pruneVolumes dry=${dry}`);
      return dry ? { volumes: { count: 1, names: ["fat"] } } : { volumes: mapPruneReports(pruneReports.volumes) };
    },
    pruneNetworks: async (_s, dry) => {
      calls.push(`pruneNetworks dry=${dry}`);
      return dry ? { networks: { count: 1, names: ["spare"] } } : { networks: mapPruneReports(pruneReports.networks) };
    },
    listVolumes: async () => [],
    listNetworks: async () => [],
    danglingVolumeNames: async () => [],
    removeVolume: async (_s, name) => (calls.push(`rmVolume ${name}`), { success: true }),
    removeNetwork: async (_s, name) => (calls.push(`rmNetwork ${name}`), { success: true }),
  };
  return { engine, calls };
}

const S = "/tmp/podtui-test/x.sock";

describe("command table", () => {
  test("the six commands of P5-T2, one high-risk", () => {
    expect(BULK_COMMANDS.map((c) => c.id)).toEqual([
      "stop-all", "prune-containers", "prune-images", "prune-volumes", "prune-networks", "remove-all",
    ]);
    expect(BULK_COMMANDS.filter((c) => c.risk === "high").map((c) => c.id)).toEqual(["remove-all"]);
  });

  test("stop-all previews exactly the running, non-infra containers and stops only those", async () => {
    const { engine, calls } = mockEngine();
    const p = await cmd("stop-all").preview(engine, S);
    const expected = containers.filter((c) => c.State === "running" && !c.IsInfra);
    expect(p.count).toBe(expected.length);
    expect(p.targets.map((t) => t.name)).toEqual(expected.map((c) => c.Names[0]!));
    const r = await cmd("stop-all").execute(engine, S, p);
    expect(calls).toEqual(expected.map((c) => `stop ${c.Id.slice(0, 12)}`));
    expect(r.done).toHaveLength(expected.length);
  });

  test("remove-all leaves pod infra containers out, says so, and forces the rest", async () => {
    const { engine, calls } = mockEngine();
    const p = await cmd("remove-all").preview(engine, S);
    const infra = containers.filter((c) => c.IsInfra).length;
    expect(infra).toBeGreaterThan(0);
    expect(p.count).toBe(containers.length - infra);
    expect(p.notes.join(" ")).toContain(`${infra} pod infra container`);
    await cmd("remove-all").execute(engine, S, p);
    expect(calls.every((c) => c.endsWith("force=true"))).toBe(true);
    expect(calls).toHaveLength(containers.length - infra);
  });

  test("execute acts on the previewed targets, not on a fresh list", async () => {
    const { engine, calls } = mockEngine();
    await cmd("stop-all").execute(engine, S, { count: 1, targets: [{ id: "abcdef123456789", name: "only" }], notes: [] });
    expect(calls).toEqual(["stop abcdef123456"]);
  });

  test("partial failures are collected by name", async () => {
    const running = containers.find((c) => c.State === "running" && !c.IsInfra)!;
    const { engine } = mockEngine({ failStop: running.Id });
    const p = await cmd("stop-all").preview(engine, S);
    const r = await cmd("stop-all").execute(engine, S, p);
    expect(r.failed).toEqual([{ name: running.Names[0]!, error: "timed out" }]);
    expect(r.done).toHaveLength(p.count - 1);
  });

  test("the container prune preview shows each container's state", async () => {
    const { engine } = mockEngine();
    const p = await cmd("prune-containers").preview(engine, S);
    expect(p.targets.map((t) => t.name)).toEqual(["failing (exited)"]);
  });

  test("prunes: preview is the dry run, execute the real one; sizes where Podman reports them", async () => {
    const { engine, calls } = mockEngine();
    const vp = await cmd("prune-volumes").preview(engine, S);
    expect(vp).toMatchObject({ count: 1, targets: [{ name: "fat" }] });
    const vr = await cmd("prune-volumes").execute(engine, S, vp);
    expect(vr).toMatchObject({ verb: "removed", noun: "volume", done: ["fat"], reclaimedBytes: 2000000 });
    const nr = await cmd("prune-networks").execute(engine, S, await cmd("prune-networks").preview(engine, S));
    expect(nr.reclaimedBytes).toBeUndefined();
    expect(calls).toEqual(["pruneVolumes dry=true", "pruneVolumes dry=false", "pruneNetworks dry=true", "pruneNetworks dry=false"]);
  });

  test("the focused panel's commands come first (P5-T6)", () => {
    expect(orderedCommands("volumes")[0]?.id).toBe("prune-volumes");
    expect(orderedCommands("networks")[0]?.id).toBe("prune-networks");
    expect(orderedCommands("containers").map((c) => c.id).slice(0, 3)).toEqual(["stop-all", "prune-containers", "remove-all"]);
    expect(orderedCommands("quadlets")).toHaveLength(6);
  });
});

describe("flow guard rails", () => {
  const preview = { count: 2, targets: [{ id: "a", name: "a" }, { id: "b", name: "b" }], notes: [] };
  const confirmFor = (c: BulkCommand): BulkFlow => ({ stage: "confirm", command: c, preview, typed: "" });

  test("Enter on a menu row asks for a preview, never an execute", () => {
    const step = bulkKey(openBulk([...BULK_COMMANDS]), "", { return: true });
    expect(step.flow?.stage).toBe("previewing");
    expect(step.effect?.type).toBe("preview");
  });

  test("Esc closes from every stage that has not executed, with no effect", () => {
    const c = cmd("prune-volumes");
    const stages: BulkFlow[] = [
      openBulk([...BULK_COMMANDS]),
      { stage: "previewing", command: c },
      { stage: "nothing", command: c },
      confirmFor(c),
      confirmFor(cmd("remove-all")),
    ];
    for (const f of stages) expect(bulkKey(f, "", { escape: true })).toEqual({ flow: null });
  });

  test("low risk: y executes; Enter and n cancel", () => {
    const c = cmd("prune-volumes");
    expect(bulkKey(confirmFor(c), "y", {}).effect).toEqual({ type: "execute", command: c, preview });
    expect(bulkKey(confirmFor(c), "", { return: true })).toEqual({ flow: null });
    expect(bulkKey(confirmFor(c), "n", {})).toEqual({ flow: null });
  });

  test(`high risk: only the exact word "${HIGH_RISK_WORD}" + Enter executes`, () => {
    const c = cmd("remove-all");
    let f: BulkFlow = confirmFor(c);
    expect(bulkKey(f, "y", {}).effect).toBeUndefined(); // y just types
    for (const wrong of ["Delete", "delet", "deletee", "yes"]) {
      let g: BulkFlow = confirmFor(c);
      for (const ch of wrong) g = bulkKey(g, ch, {}).flow!;
      expect(bulkKey(g, "", { return: true }).effect).toBeUndefined();
    }
    for (const ch of "deletx") f = bulkKey(f, ch, {}).flow!;
    f = bulkKey(f, "", { backspace: true }).flow!;
    f = bulkKey(f, "e", {}).flow!;
    expect(f.stage === "confirm" && f.typed).toBe("delete");
    expect(bulkKey(f, "", { return: true }).effect?.type).toBe("execute");
  });

  test("while running, keys are ignored (the call is already out)", () => {
    const f: BulkFlow = { stage: "running", command: cmd("prune-volumes"), preview };
    expect(bulkKey(f, "", { escape: true })).toEqual({ flow: f });
  });

  test("a preview of nothing ends at 'nothing'; a stale result is ignored", () => {
    const c = cmd("prune-images");
    const f: BulkFlow = { stage: "previewing", command: c };
    expect(previewed(f, c, { preview: { count: 0, targets: [], notes: [] } })?.stage).toBe("nothing");
    expect(previewed(null, c, { preview })).toBeNull();
    expect(previewed(f, cmd("prune-volumes"), { preview })).toBe(f);
    expect(executed({ stage: "running", command: c, preview }, c, { error: "boom" })).toEqual({ stage: "failed", command: c, message: "boom" });
  });
});

describe("screens", () => {
  test("names: first 10, then 'and M more'", () => {
    const names = Array.from({ length: 13 }, (_, i) => `c${i}`);
    expect(nameList(names)).toBe("c0, c1, c2, c3, c4, c5, c6, c7, c8, c9 … and 3 more");
    expect(nameList(["a"])).toBe("a");
  });

  test("result summary with size and partial failures", () => {
    expect(resultSummary({ verb: "removed", noun: "volume", done: ["a", "b", "c"], failed: [], reclaimedBytes: 120_000_000 })).toBe(
      "Removed 3 volumes, reclaimed 120.0MB",
    );
    expect(resultSummary({ verb: "stopped", noun: "container", done: ["a"], failed: [{ name: "b", error: "x" }] })).toBe(
      "Stopped 1 container; 1 failed",
    );
  });

  test("confirm screen: count, names, notes and the typed-word prompt for high risk", () => {
    const c = cmd("remove-all");
    const content = bulkContent({ stage: "confirm", command: c, preview: { count: 2, targets: [{ id: "a", name: "web" }, { id: "b", name: "chatty" }], notes: ["note"] }, typed: "del" });
    const text = content.rows.map((r) => r.text).join("\n");
    expect(text).toContain("This will remove 2 containers:");
    expect(text).toContain("web, chatty");
    expect(text).toContain(`Type ${HIGH_RISK_WORD} and press Enter`);
    expect(text).toContain("> del▌");
    expect(content.danger).toBe(true);
  });

  test("partial failure screen lists each failure", () => {
    const content = bulkContent({
      stage: "result",
      command: cmd("stop-all"),
      result: { verb: "stopped", noun: "container", done: ["a"], failed: [{ name: "web", error: "timed out" }] },
    });
    expect(content.rows.map((r) => r.text)).toContain("web: timed out");
  });

  test("every stage renders at exact size", () => {
    const c = cmd("prune-volumes");
    for (const f of [
      openBulk([...BULK_COMMANDS]),
      { stage: "previewing", command: c } as BulkFlow,
      { stage: "nothing", command: c } as BulkFlow,
      { stage: "confirm", command: c, preview: { count: 30, targets: Array.from({ length: 30 }, (_, i) => ({ id: `${i}`, name: `volume-${i}` })), notes: ["n"] }, typed: "" } as BulkFlow,
      { stage: "failed", command: c, message: "x".repeat(300) } as BulkFlow,
    ]) {
      const content = bulkContent(f);
      const rect = bulkRect(100, 30, content)!;
      for (const color of [true, false]) {
        const out = renderBulk(rect, content, defaultTheme, color);
        expect(out).toHaveLength(rect.h);
        for (const line of out) expect(displayWidth(line)).toBe(rect.w);
      }
    }
  });
});

describe("menu alignment", () => {
  test("unselected rows keep their leading space, so numbers line up", () => {
    const content = bulkContent(openBulk([...BULK_COMMANDS]));
    const rect = bulkRect(100, 30, content)!;
    const rows = renderBulk(rect, content, defaultTheme, false).filter((l) => /\d {2}/.test(l));
    const cols = rows.map((l) => l.search(/\d {2}/));
    expect(new Set(cols).size).toBe(1);
  });
});
