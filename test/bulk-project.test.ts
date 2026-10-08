/**
 * The `x` menu in project mode: only the project's own items, never a
 * Podman-wide prune. Fixture: compose-projects.json (two real projects
 * started from one folder) plus unrelated items that must stay untouched.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ContainerListItem } from "../src/api/types.ts";
import { commandsFor, projectCommands, BULK_COMMANDS, type BulkEngine } from "../src/ui/bulk/commands.ts";

const fx = JSON.parse(readFileSync("test/fixtures/compose-projects.json", "utf8"));
const outsider = (name: string, State: string) =>
  ({ Id: `id-${name}`, Names: [name], State, ImageID: "x", Labels: {}, Networks: [] }) as unknown as ContainerListItem;
const containers: ContainerListItem[] = [
  ...fx.containers.map((c: ContainerListItem, i: number) => (i === 0 ? { ...c, State: "exited" } : c)),
  outsider("my-real-db", "exited"),
  outsider("flutter-dev", "running"),
];

function engine() {
  const calls: string[] = [];
  const e: BulkEngine = {
    listContainers: async () => containers,
    listVolumes: async () => [...fx.volumes, { Name: "precious", Labels: {} }],
    listNetworks: async () => [...fx.networks, { name: "lonely", labels: {} }],
    danglingVolumeNames: async () => ["shopdemo_data", "precious"],
    stopContainer: async (_s, id) => (calls.push(`stop ${id.slice(0, 12)}`), { success: true }),
    removeContainer: async (_s, id, force) => (calls.push(`rm ${id.slice(0, 12)} force=${force}`), { success: true }),
    removeVolume: async (_s, n) => (calls.push(`rmVolume ${n}`), { success: true }),
    removeNetwork: async (_s, n) => (calls.push(`rmNetwork ${n}`), { success: true }),
    pruneContainers: async () => (calls.push("PRUNE containers"), {}),
    pruneImages: async () => (calls.push("PRUNE images"), {}),
    pruneVolumes: async () => (calls.push("PRUNE volumes"), {}),
    pruneNetworks: async () => (calls.push("PRUNE networks"), {}),
  };
  return { e, calls };
}

const S = "/tmp/podtui-test/x.sock";
const cmds = projectCommands(["shopdemo"]);
const cmd = (id: string) => cmds.find((c) => c.id === id)!;

describe("project-mode bulk commands", () => {
  test("no prune and no image command is offered; --all keeps the Podman-wide set", () => {
    expect(cmds.map((c) => c.id)).toEqual(["project-stop-all", "project-rm-stopped", "project-rm-volumes", "project-rm-networks", "project-remove-all"]);
    expect(commandsFor({ kind: "all" })).toBe(BULK_COMMANDS);
    expect(commandsFor({ kind: "project", dir: "/x", projects: ["shopdemo"], composeFile: null }).map((c) => c.id)).toEqual(cmds.map((c) => c.id));
  });

  test("every command previews and executes ONLY project items, and never prunes", async () => {
    const { e, calls } = engine();
    const named: Record<string, string[]> = {};
    for (const c of cmds) {
      const p = await c.preview(e, S);
      named[c.id] = p.targets.map((t) => t.name);
      await c.execute(e, S, p);
    }
    expect(named["project-stop-all"]).toEqual(["shopdemo_db_1"]);
    expect(named["project-rm-stopped"]).toEqual(["shopdemo_web_1 (exited)"]);
    expect(named["project-rm-volumes"]).toEqual(["shopdemo_data"]);
    // The project's containers are on shopdemo_default (fixture), so it is in use.
    expect(named["project-rm-networks"]).toEqual([]);
    expect(named["project-remove-all"]!.sort()).toEqual(["shopdemo_db_1", "shopdemo_web_1"]);
    const text = calls.join("\n");
    expect(text).not.toContain("PRUNE");
    for (const outside of ["my-real-db", "flutter-dev", "precious", "lonely", "dc-shop"]) expect(text).not.toContain(outside);
  });

  test("the other project started from the same folder is separate", async () => {
    const { e } = engine();
    const p = await projectCommands(["dc-shop"])[4]!.preview(e, S);
    expect(p.targets.map((t) => t.name).sort()).toEqual(["dc-shop-db-1", "dc-shop-web-1"]);
  });

  test("a project network no container is on is offered", async () => {
    const { e } = engine();
    const bare = { ...e, listContainers: async () => containers.map((c) => ({ ...c, Networks: [] })) };
    const p = await cmd("project-rm-networks").preview(bare, S);
    expect(p.targets.map((t) => t.name)).toEqual(["shopdemo_default"]);
  });

  test("the high-risk command stays high-risk", () => {
    expect(cmd("project-remove-all").risk).toBe("high");
  });
});
