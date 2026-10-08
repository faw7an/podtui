/**
 * Plain `podtui` = your containers from any folder; `--all` adds toolbox and
 * distrobox environments. Labels in the fixture were read from the
 * maintainer's real Podman (labels only).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ContainerListItem } from "../src/api/types.ts";
import { applyScope, emptyContainersNote, environmentKind, isEnvironment, scopeLabel } from "../src/engine/scope.ts";
import { BULK_COMMANDS, commandsFor, mineCommands, type BulkEngine } from "../src/ui/bulk/commands.ts";

const real = JSON.parse(readFileSync("test/fixtures/environment-labels.json", "utf8")).containers as { example: string; Labels: Record<string, string> }[];

const c = (id: string, labels: Record<string, string>, State = "running", ImageID = `img-${id}`): ContainerListItem =>
  ({ Id: id, Names: [id], State, ImageID, Labels: labels, Networks: [] }) as unknown as ContainerListItem;
const TOOLBOX = { "com.github.containers.toolbox": "true" };
const DISTROBOX = { manager: "distrobox", "distrobox.unshare_groups": "0" };
const COMPOSE = { "com.docker.compose.project": "shop", "com.docker.compose.project.working_dir": "/home/me/code/shop" };

describe("which containers are environments", () => {
  test("the real labels: toolbox and distrobox are environments, podman run is yours", () => {
    for (const r of real) {
      expect(isEnvironment(r.Labels)).toBe(r.example !== "podman run");
    }
    expect(environmentKind(TOOLBOX)).toBe("toolbox");
    expect(environmentKind(DISTROBOX)).toBe("distrobox");
  });

  test("compose containers are yours, wherever they were started", () => {
    expect(isEnvironment(COMPOSE)).toBe(false);
    expect(isEnvironment({})).toBe(false);
    expect(isEnvironment(null)).toBe(false);
  });
});

describe("applyScope", () => {
  const box = c("box", TOOLBOX, "exited", "img-shared-env");
  const dev = c("dev", DISTROBOX, "running", "img-shared-env");
  const db = c("db", {}, "running", "img-postgres");
  const web = c("web", COMPOSE, "running", "img-nginx");
  const data = {
    containers: [box, dev, db, web],
    pods: [
      { Id: "pod-env", Containers: [{ Id: "dev" }] },
      { Id: "pod-mine", Containers: [{ Id: "web" }, { Id: "dev" }] },
      { Id: "pod-empty", Containers: [] },
    ],
    images: [{ Id: "img-shared-env" }, { Id: "img-postgres" }, { Id: "img-nginx" }, { Id: "img-unused" }],
  };

  test("mine: environments, pods made only of them, and images only they use are hidden", () => {
    const s = applyScope({ kind: "mine" }, data);
    expect(s.containers.map((x) => x.Id)).toEqual(["db", "web"]);
    expect(s.pods.map((p) => p.Id)).toEqual(["pod-mine", "pod-empty"]);
    expect(s.images.map((i) => i.Id)).toEqual(["img-postgres", "img-nginx", "img-unused"]);
    expect(s.hiddenEnvironments).toBe(2);
  });

  test("all: everything, nothing hidden", () => {
    const s = applyScope({ kind: "all" }, data);
    expect(s.containers).toHaveLength(4);
    expect(s.hiddenEnvironments).toBe(0);
  });
});

describe("labels and empty state", () => {
  test("header", () => {
    expect(scopeLabel({ kind: "mine" })).toBe("your containers");
    expect(scopeLabel({ kind: "all" })).toBe("all containers");
  });

  test("no containers of yours: how to start one, from any folder, and how many are hidden", () => {
    expect(emptyContainersNote({ kind: "mine" }, 3)).toBe(
      "No containers yet. Start one with podman run … or podman compose up -d — it shows up here from any folder. 3 toolbox/distrobox environments are hidden; podtui --all shows them.",
    );
    expect(emptyContainersNote({ kind: "mine" }, 0)).not.toContain("hidden");
    expect(emptyContainersNote({ kind: "all" }, 0)).toBeNull();
  });
});

describe("the x menu in the default view never touches environments", () => {
  const all = [c("box", TOOLBOX, "exited"), c("dev", DISTROBOX, "running"), c("db", {}, "exited"), c("web", COMPOSE, "running")];
  function engine() {
    const calls: string[] = [];
    const e: BulkEngine = {
      listContainers: async () => all,
      stopContainer: async (_s, id) => (calls.push(`stop ${id}`), { success: true }),
      removeContainer: async (_s, id, force) => (calls.push(`rm ${id} force=${force}`), { success: true }),
      pruneContainers: async () => (calls.push("PRUNE containers"), {}),
      pruneImages: async () => (calls.push("prune images"), {}),
      pruneVolumes: async () => (calls.push("prune volumes"), {}),
      pruneNetworks: async () => (calls.push("prune networks"), {}),
      listVolumes: async () => [],
      listNetworks: async () => [],
      danglingVolumeNames: async () => [],
      removeVolume: async () => ({ success: true }),
      removeNetwork: async () => ({ success: true }),
    };
    return { e, calls };
  }

  test("container commands act on yours only; no container prune is ever called", async () => {
    const { e, calls } = engine();
    const cmds = mineCommands();
    for (const id of ["mine-stop-all", "mine-rm-stopped", "mine-remove-all"]) {
      const cmd = cmds.find((x) => x.id === id)!;
      await cmd.execute(e, "/x", await cmd.preview(e, "/x"));
    }
    expect(calls).toEqual(["stop web", "rm db force=false", "rm db force=true", "rm web force=true"]);
  });

  test("image/volume/network prunes stay (they only remove unused items); --all keeps the Podman-wide set", () => {
    expect(mineCommands().map((x) => x.id)).toEqual(["mine-stop-all", "mine-rm-stopped", "prune-images", "prune-volumes", "prune-networks", "mine-remove-all"]);
    expect(commandsFor({ kind: "all" })).toBe(BULK_COMMANDS);
    expect(mineCommands().find((x) => x.id === "mine-remove-all")?.risk).toBe("high");
  });
});
