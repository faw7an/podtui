/**
 * Pod, image, volume and network detail views (P4-T1..T4), from fixtures.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type {
  ContainerListItem,
  ImageHistoryEntry,
  ImageInspect,
  NetworkInspect,
  PodInspect,
  VolumeInspect,
} from "../src/api/types.ts";
import {
  TABS_BY_PANEL,
  cleanCreatedBy,
  imageView,
  networkMembers,
  networkView,
  podView,
  volumeView,
} from "../src/ui/view/resourceDetail.ts";
import { EMPTY_DATA, buildFrameModel, buildPanelModels, type ResourceData } from "../src/ui/view/build.ts";
import { PANEL_IDS, type PanelId } from "../src/ui/layout/types.ts";

const fx = <T>(f: string): T => JSON.parse(readFileSync(`test/fixtures/${f}`, "utf8")) as T;
const pod = fx<PodInspect>("pod-inspect.json");
const image = fx<ImageInspect>("image-inspect.json");
const history = fx<ImageHistoryEntry[]>("image-history.json");
const volume = fx<VolumeInspect>("volume-inspect.json");
const network = fx<NetworkInspect>("network-inspect-connected.json");
const containers = fx<ContainerListItem[]>("containers-list.json");
const data: ResourceData = { ...EMPTY_DATA, containers, images: fx("images-list.json"), networks: fx("networks-list.json") };
const now = Date.parse("2026-10-08T12:00:00Z");

describe("tabs per panel", () => {
  test("containers keep their five; pods, images have two; the rest one", () => {
    expect(TABS_BY_PANEL.containers.map((t) => t.label)).toEqual(["Logs", "Stats", "Env", "Config", "Top"]);
    expect(TABS_BY_PANEL.pods.map((t) => t.label)).toEqual(["Config", "Containers"]);
    expect(TABS_BY_PANEL.images.map((t) => t.label)).toEqual(["Config", "History"]);
    expect(TABS_BY_PANEL.volumes.map((t) => t.label)).toEqual(["Config"]);
  });
});

describe("pod", () => {
  test("config reads the inspect shape (State, InfraContainerID, NumContainers)", () => {
    const text = podView("config", pod).lines.join("\n");
    expect(text).toContain("web-pod");
    expect(text).toMatch(/State +Running/);
    expect(text).toMatch(/Containers +3/);
    expect(text).toMatch(new RegExp(`Infra +${pod.InfraContainerID!.slice(0, 12)}`));
    expect(text).toMatch(/Shared ns +ipc net uts/);
  });

  test("members tab: a table with the infra container marked", () => {
    const v = podView("members", pod);
    expect(v.table).toBe(true);
    expect(v.lines[0]).toMatch(/^NAME +STATE +ID$/);
    expect(v.lines.filter((l) => l.endsWith("(infra)"))).toHaveLength(1);
    expect(v.hint).toBe("3 containers");
  });
});

describe("image", () => {
  test("config: tags, size, entrypoint, and the containers using it", () => {
    const text = imageView("config", image, history, data, now).lines.join("\n");
    expect(text).toMatch(/Tags +nginx:alpine/);
    expect(text).toMatch(/Size +64\.3MB/);
    expect(text).toMatch(/Entrypoint +\/docker-entrypoint\.sh/);
    expect(text).toMatch(/Containers +web · running/);
  });

  test("history: one row per layer, cleaned commands, sticky header", () => {
    const v = imageView("history", image, history, data, now);
    expect(v.table).toBe(true);
    expect(v.lines).toHaveLength(history.length + 1);
    expect(v.lines.join("\n")).not.toContain("/bin/sh -c");
    expect(v.hint).toBe(`${history.length} layers`);
  });

  test("history still loading", () => {
    expect(imageView("history", image, null, data, now).lines).toEqual(["Loading history…"]);
  });

  test("cleanCreatedBy", () => {
    expect(cleanCreatedBy("/bin/sh -c #(nop)  CMD [\"nginx\"]")).toBe('CMD ["nginx"]');
    expect(cleanCreatedBy("RUN /bin/sh -c set -x     && apk add  x")).toBe("RUN set -x && apk add x");
  });
});

describe("volume", () => {
  test("lists users, or says unused", () => {
    expect(volumeView(volume, []).lines.join("\n")).toMatch(/Containers +\(none: unused\)/);
    const used = volumeView(volume, [containers[0]!]).lines.join("\n");
    expect(used).toMatch(/Containers +web · running/);
  });
});

describe("network", () => {
  test("members come from the list (any state) with IPs from inspect", () => {
    const probeId = Object.keys(network.containers)[0]!;
    const listed: ResourceData = {
      ...data,
      containers: [
        { ...containers[0]!, Id: probeId, Names: ["probe-net"], State: "running", Networks: ["test-network"] },
        { ...containers[1]!, Names: ["stopped-one"], State: "exited", Networks: ["test-network"] },
      ],
    };
    expect(networkMembers(network, listed)).toEqual([
      { name: "probe-net", state: "running", ip: "10.89.0.2/24" },
      { name: "stopped-one", state: "exited", ip: "" },
    ]);
    const text = networkView(network, listed).lines.join("\n");
    expect(text).toMatch(/Subnet +10\.89\.0\.0\/24 gw 10\.89\.0\.1/);
    expect(text).toMatch(/Connected +probe-net · running · 10\.89\.0\.2\/24/);
  });

  test("a container only inspect knows about is still shown", () => {
    expect(networkMembers(network, data).map((m) => m.name)).toEqual(["probe-net"]);
  });
});

describe("list rows (P4-T2/T4)", () => {
  const sel = Object.fromEntries(PANEL_IDS.map((p) => [p, ""])) as Record<PanelId, string>;
  test("untagged images are named <none> <id> and marked; used images say in use", () => {
    const untagged = fx<ResourceData["images"]>("images-list-untagged.json");
    const rows = buildPanelModels({ ...data, images: [...data.images, ...untagged] }, sel, now).find((p) => p.id === "images")!;
    const last = rows.items.at(-1)!;
    expect(last.cells["name"]).toMatch(/^<none> [0-9a-f]{12}$/);
    expect(last.cells["state"]).toContain("untagged");
  });

  test("networks show their subnet and container count", () => {
    const rows = buildPanelModels(
      { ...data, containers: [{ ...containers[0]!, Networks: ["test-network"] }] },
      sel,
      now,
    ).find((p) => p.id === "networks")!;
    const testNet = rows.items.find((r) => r.cells["name"] === "test-network")!;
    expect(testNet.cells["subnet"]).toBe("10.89.0.0/24");
    expect(testNet.cells["count"]).toBe("1");
  });
});

describe("frame model wiring", () => {
  const sel = Object.fromEntries(PANEL_IDS.map((p) => [p, ""])) as Record<PanelId, string>;
  const podsData: ResourceData = { ...data, pods: fx("pods-list.json") };
  const podId = podsData.pods[0]!.Id;

  test("detail for the pods panel uses pod tabs, and waits for THIS pod's inspect", () => {
    const base = { data: podsData, selected: { ...sel, pods: podId }, focus: "pods" as const, now, clock: "" };
    expect(buildFrameModel(base).detail.lines).toEqual(["Loading…"]);
    const stale = buildFrameModel({ ...base, resource: { panel: "pods", id: "other", inspect: pod } });
    expect(stale.detail.lines).toEqual(["Loading…"]);
    const d = buildFrameModel({ ...base, resource: { panel: "pods", id: podId, inspect: pod }, activeTab: "members" }).detail;
    expect(d.tabs).toEqual(["Config", "Containers"]);
    expect(d.activeTab).toBe(1);
    expect(d.table).toBe(true);
  });

  test("with the detail pane focused, detailPanel keeps showing the pod (not containers)", () => {
    const d = buildFrameModel({
      data: podsData,
      selected: { ...sel, pods: podId },
      focus: "detail",
      detailPanel: "pods",
      now,
      clock: "",
      resource: { panel: "pods", id: podId, inspect: pod },
    }).detail;
    expect(d.title).toContain("web-pod");
    expect(d.tabs).toEqual(["Config", "Containers"]);
  });
});
