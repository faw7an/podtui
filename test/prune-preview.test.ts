import { describe, expect, test } from "bun:test";
import { mapPruneReports, previewContainers, previewImages } from "../src/engine/podman.ts";
import type { ContainerListItem, ImageListItem } from "../src/api/types.ts";

/**
 * Pure rules behind the prune previews. The authoritative check is
 * `prune-contract.test.ts` (real prune vs preview); these pin each rule down
 * without a daemon so a regression names the exact case that broke.
 */

function ctr(name: string, state: string, pod = ""): ContainerListItem {
  return { Id: `${name}-id`.padEnd(64, "0"), Names: [name], State: state, Pod: pod } as ContainerListItem;
}

describe("previewContainers (libpod PruneContainers rule)", () => {
  test("stopped, exited, created and configured are prunable", () => {
    const list = ["stopped", "exited", "created", "configured"].map((s) => ctr(`c-${s}`, s));
    expect(previewContainers(list).containers?.names.sort()).toEqual(
      ["c-configured", "c-created", "c-exited", "c-stopped"],
    );
  });

  test("running and paused containers are kept", () => {
    const list = [ctr("run", "running"), ctr("pause", "paused")];
    expect(previewContainers(list).containers?.count).toBe(0);
  });

  test("containers in a pod are never pruned, even when exited", () => {
    // Observed live: an exited pod member and the pod's created infra
    // container both survived `POST /containers/prune`.
    const list = [ctr("member", "exited", "podid"), ctr("infra", "created", "podid"), ctr("solo", "exited")];
    expect(previewContainers(list).containers?.names).toEqual(["solo"]);
  });

  test("state matching ignores case", () => {
    expect(previewContainers([ctr("x", "Exited")]).containers?.names).toEqual(["x"]);
  });
});

function img(id: string, opts: { parent?: string; tagged?: boolean; containers?: number; manifest?: boolean } = {}): ImageListItem {
  const fullId = id.padEnd(64, "0");
  return {
    Id: fullId,
    ParentId: opts.parent ? opts.parent.padEnd(64, "0") : "",
    Names: opts.tagged ? [`localhost/${id}:latest`] : undefined,
    RepoTags: opts.tagged ? [`localhost/${id}:latest`] : null,
    Containers: opts.containers ?? 0,
    IsManifestList: opts.manifest ?? false,
  } as unknown as ImageListItem;
}

const ids = (...short: string[]) => new Set(short.map((s) => s.padEnd(64, "0")));
const previewed = (all: ImageListItem[], dangling: Set<string>) =>
  [...(previewImages(all, dangling).images?.names ?? [])].sort();

describe("previewImages (prune converges)", () => {
  test("a dangling image is prunable", () => {
    const all = [img("base", { tagged: true }), img("aaaa", { parent: "base" })];
    expect(previewed(all, ids("aaaa"))).toEqual(["aaaa00000000"]);
  });

  test("removing a dangling image cascades to its untagged parent (live: 2 removed, 1 dangling)", () => {
    const all = [
      img("base", { tagged: true }),
      img("mid1", { parent: "base" }),
      img("top1", { parent: "mid1" }),
    ];
    expect(previewed(all, ids("top1"))).toEqual(["mid100000000", "top100000000"]);
  });

  test("the cascade stops at a tagged parent", () => {
    const all = [img("base", { tagged: true }), img("top1", { parent: "base" })];
    expect(previewed(all, ids("top1"))).toEqual(["top100000000"]);
  });

  test("the cascade stops at a parent that still has another child", () => {
    const all = [
      img("base", { tagged: true }),
      img("mid1", { parent: "base" }),
      img("keep", { parent: "mid1", tagged: true }),
      img("gone", { parent: "mid1" }),
    ];
    expect(previewed(all, ids("gone"))).toEqual(["gone00000000"]);
  });

  test("the cascade stops at a parent used by a container", () => {
    const all = [img("mid1", { containers: 1 }), img("top1", { parent: "mid1" })];
    expect(previewed(all, ids("top1"))).toEqual(["top100000000"]);
  });

  test("the cascade stops at a manifest list", () => {
    const all = [img("list", { manifest: true }), img("top1", { parent: "list" })];
    expect(previewed(all, ids("top1"))).toEqual(["top100000000"]);
  });

  test("a dangling image used by a container is kept (prune passes containers=false)", () => {
    const all = [img("used", { containers: 2 })];
    expect(previewed(all, ids("used"))).toEqual([]);
  });

  test("an untagged intermediate with children is NOT prunable on its own", () => {
    // The old preview listed every untagged image, intermediates included.
    const all = [img("mid1"), img("top1", { parent: "mid1", tagged: true })];
    expect(previewed(all, ids())).toEqual([]);
  });
});

describe("mapPruneReports", () => {
  test("counts successes, sums sizes, shortens IDs", () => {
    const raw = [
      { Id: "a".repeat(64), Size: 10 },
      { Id: "b".repeat(64), Size: 5 },
    ];
    expect(mapPruneReports(raw)).toEqual({
      count: 2,
      names: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"],
      reclaimedBytes: 15,
      failed: [],
    });
  });

  test("an entry with Err is a failure, not a removal", () => {
    const raw = [{ Id: "a".repeat(64), Size: 10 }, { Id: "b".repeat(64), Size: 99, Err: "device busy" }];
    const out = mapPruneReports(raw);
    expect(out.count).toBe(1);
    expect(out.reclaimedBytes).toBe(10);
    expect(out.failed).toEqual([{ name: "bbbbbbbbbbbb", error: "device busy" }]);
  });

  test("Go errors serialized as {} still count as failures", () => {
    const out = mapPruneReports([{ Id: "v1", Err: {} }]);
    expect(out.count).toBe(0);
    expect(out.failed).toEqual([{ name: "v1", error: "removal failed" }]);
  });

  test("network reports use Name/Error, and Error:null is success", () => {
    const out = mapPruneReports([{ Name: "n-unused", Error: null }, { Name: "n-bad", Error: "in use" }]);
    expect(out.names).toEqual(["n-unused"]);
    expect(out.failed).toEqual([{ name: "n-bad", error: "in use" }]);
  });

  test("a non-array body yields an empty result instead of throwing", () => {
    expect(mapPruneReports({}).count).toBe(0);
    expect(mapPruneReports(null).count).toBe(0);
  });
});
