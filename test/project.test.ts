/**
 * Project scope: plain `podtui` shows the compose project of the current
 * folder. Fixture: one compose.yaml in /tmp/podtui-test/shopdemo started with
 * podman-compose (project shopdemo, in pod_shopdemo) and with Docker Compose
 * (-p dc-shop) — both recorded live.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ContainerListItem } from "../src/api/types.ts";
import { applyScope, isWithin, projectScope, scopeEmptyNote, scopeLabel } from "../src/engine/project.ts";

const fx = JSON.parse(readFileSync("test/fixtures/compose-projects.json", "utf8"));
const other = { Id: "other", Names: ["unrelated"], State: "running", ImageID: "img-x", Labels: {} } as unknown as ContainerListItem;
const containers: ContainerListItem[] = [...fx.containers, other];
const DIR = "/tmp/podtui-test/shopdemo";

describe("projectScope", () => {
  test("in the project folder: every project started from it (here podman-compose AND docker compose)", () => {
    expect(projectScope(DIR, containers, "compose.yaml")).toEqual({ kind: "project", dir: DIR, projects: ["dc-shop", "shopdemo"], composeFile: "compose.yaml" });
  });

  test("from a subfolder too; a trailing slash does not matter", () => {
    expect(projectScope(`${DIR}/src/lib`, containers, null)).toMatchObject({ dir: DIR, projects: ["dc-shop", "shopdemo"] });
    expect(projectScope(`${DIR}/`, containers, null)).toMatchObject({ projects: ["dc-shop", "shopdemo"] });
  });

  test("a parent or sibling folder is not the project", () => {
    expect(projectScope("/tmp/podtui-test", containers, null)).toMatchObject({ projects: [] });
    expect(projectScope("/tmp/podtui-test/shopdemo-old", containers, null)).toMatchObject({ projects: [] });
  });

  test("the nearest project wins over one that contains it", () => {
    const outer = { ...other, Id: "o", Labels: { "com.docker.compose.project": "mono", "com.docker.compose.project.working_dir": "/tmp/podtui-test" } } as unknown as ContainerListItem;
    expect(projectScope(DIR, [...containers, outer], null)).toMatchObject({ projects: ["dc-shop", "shopdemo"] });
    expect(projectScope("/tmp/podtui-test/elsewhere", [...containers, outer], null)).toMatchObject({ projects: ["mono"] });
  });

  test("isWithin", () => {
    expect(isWithin("/a/b", "/a")).toBe(true);
    expect(isWithin("/ab", "/a")).toBe(false);
    expect(isWithin("/a", "/a/")).toBe(true);
  });
});

describe("applyScope", () => {
  const data = { containers, pods: fx.pods, images: [{ Id: fx.containers[0].ImageID }, { Id: "img-x" }], volumes: [...fx.volumes, { Name: "mine", Labels: {} }], networks: [...fx.networks, { name: "podman", labels: {} }] };

  test("project: only its containers, the pod holding them, images they use, labelled volumes and networks", () => {
    const s = applyScope(projectScope(DIR, containers, null), data);
    expect(s.containers.map((c) => c.Names[0]).sort()).toEqual(["dc-shop-db-1", "dc-shop-web-1", "shopdemo_db_1", "shopdemo_web_1"]);
    expect(s.pods.map((p: { Name: string }) => p.Name)).toEqual(["pod_shopdemo"]);
    expect(s.images.map((i) => i.Id)).toEqual([fx.containers[0].ImageID]);
    expect(s.volumes.map((v) => v.Name).sort()).toEqual(["dc-shop_data", "shopdemo_data"]);
    expect(s.networks.map((n) => n.name).sort()).toEqual(["dc-shop_default", "shopdemo_default"]);
  });

  test("no project: everything empty; all: everything unchanged", () => {
    const none = applyScope(projectScope("/home/me", containers, null), data);
    expect([none.containers, none.pods, none.images, none.volumes, none.networks].every((x) => x.length === 0)).toBe(true);
    expect(applyScope({ kind: "all" }, data)).toBe(data);
  });
});

describe("labels and empty-state text", () => {
  test("header label", () => {
    expect(scopeLabel({ kind: "all" })).toBe("all containers");
    expect(scopeLabel(projectScope(DIR, containers, null))).toBe("project: dc-shop, shopdemo");
    expect(scopeLabel(projectScope("/x", containers, null))).toBe("no project here");
  });

  test("an empty project view says what to do, depending on whether a compose file is here", () => {
    expect(scopeEmptyNote(projectScope("/x", containers, "compose.yaml"))).toContain("compose.yaml is here but nothing from it has run yet");
    expect(scopeEmptyNote(projectScope("/x", containers, null))).toContain("No compose project in /x");
    expect(scopeEmptyNote(projectScope("/x", containers, null))).toContain("podtui --all");
    expect(scopeEmptyNote(projectScope(DIR, containers, null))).toBeNull();
    expect(scopeEmptyNote({ kind: "all" })).toBeNull();
  });
});
