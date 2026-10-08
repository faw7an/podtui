/**
 * Cross-links (P4-T7): `c` from a pod to its containers; a container's
 * Config names its pod, image, volumes and networks.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ContainerInspect, PodListItem } from "../src/api/types.ts";
import { podJumpTarget } from "../src/ui/actions/selectionAction.ts";
import { initialState, reducer } from "../src/ui/layout/layoutReducer.ts";
import { buildDetail } from "../src/ui/view/detail.ts";
import { EMPTY_DATA } from "../src/ui/view/build.ts";

const fx = <T>(f: string): T => JSON.parse(readFileSync(`test/fixtures/${f}`, "utf8")) as T;
const pods = fx<PodListItem[]>("pods-list.json");
const inspect = fx<ContainerInspect>("container-inspect.json");

describe("podJumpTarget", () => {
  test("lands on the first non-infra member and says how many more", () => {
    const pod = pods[0]!;
    const t = podJumpTarget({ ...EMPTY_DATA, pods }, pod.Id);
    expect(t).toEqual({ kind: "jump", id: pod.Containers[1]!.Id, message: "web-pod: web-pod-frontend (+1 more in this pod)" });
  });

  test("an infra-only pod and a missing pod explain themselves", () => {
    const lonely = { ...pods[0]!, Containers: [pods[0]!.Containers[0]!] };
    expect(podJumpTarget({ ...EMPTY_DATA, pods: [lonely] }, lonely.Id).kind).toBe("none");
    expect(podJumpTarget({ ...EMPTY_DATA, pods }, "gone")).toEqual({ kind: "none", message: "Select a pod first." });
  });

  test("the App's dispatch sequence focuses Containers and selects the member, even from fullscreen or hidden", () => {
    let s = reducer(initialState(), { type: "activate", id: "pods" });
    s = reducer(s, { type: "openDetail" });
    s = reducer(s, { type: "toggle", id: "containers" }); // hidden meanwhile
    for (const a of [
      { type: "escape" } as const,
      { type: "activate", id: "containers" } as const,
      { type: "select", id: "containers", itemId: "member-1" } as const,
    ]) s = reducer(s, a);
    expect(s.detailFullscreen).toBe(false);
    expect(s.focus).toBe("containers");
    expect(s.visible.has("containers")).toBe(true);
    expect(s.selected.containers).toBe("member-1");
  });
});

describe("container Config: Links", () => {
  const links = (i: ContainerInspect, podName?: string): string[] => {
    const lines = buildDetail({ inspect: i, activeTab: "config", hasSelection: true, links: { podName } }).lines;
    const start = lines.indexOf("# Links");
    const end = lines.findIndex((l, n) => n > start && l.startsWith("# "));
    return lines.slice(start + 1, end < 0 ? undefined : end);
  };

  test("fixture `web`: no pod, its image, no volumes, pasta networking", () => {
    expect(links(inspect)).toEqual([
      "Pod          (none)",
      "Image        docker.io/library/nginx:alpine  (3 Images)",
      "Volumes      (none)",
      "Networks     (none: pasta mode)",
    ]);
  });

  test("a pod member with a volume, a bind mount and a bridge network", () => {
    const i: ContainerInspect = {
      ...inspect,
      Pod: "f77579bd1aad",
      Mounts: [
        { Type: "volume", Name: "data", Source: "/x", Destination: "/data" } as never,
        { Type: "bind", Source: "/home/me/conf", Destination: "/etc/app" } as never,
      ],
      NetworkSettings: { ...inspect.NetworkSettings, Networks: { "test-network": {} } },
    };
    expect(links(i, "web-pod")).toEqual([
      "Pod          web-pod  (1 Pods)",
      "Image        docker.io/library/nginx:alpine  (3 Images)",
      "Volumes      data → /data  (4 Volumes)",
      "Mounts       bind /home/me/conf → /etc/app",
      "Networks     test-network  (5 Networks)",
    ]);
  });

  test("a pseudo-network key (`pasta`, seen live) is a mode, not a podman network", () => {
    const i: ContainerInspect = {
      ...inspect,
      HostConfig: { ...inspect.HostConfig, NetworkMode: "pasta" },
      NetworkSettings: { ...inspect.NetworkSettings, Networks: { pasta: {} } },
    };
    const lines = buildDetail({ inspect: i, activeTab: "config", hasSelection: true, links: { networkNames: ["podman", "test-network"] } }).lines;
    expect(lines).toContain("Networks     (none: pasta mode)");
  });

  test("Links folds with the other sections", () => {
    const lines = buildDetail({ inspect, activeTab: "config", hasSelection: true, collapsed: new Set(["links"]) }).lines;
    const at = lines.indexOf("# Links (+)");
    expect(at).toBeGreaterThan(-1);
    // Folded: the very next row is another section heading.
    expect(lines[at + 1]?.startsWith("# ")).toBe(true);
  });
});
