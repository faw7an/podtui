import type {
  ContainerListItem,
  ImageHistoryEntry,
  ImageInspect,
  NetworkInspect,
  PodInspect,
  VolumeInspect,
} from "../../api/types.ts";
import { formatAge, formatBytes, parsePodmanTime, shortenImageName } from "../../util/format.ts";
import type { PanelId } from "../layout/types.ts";
import type { ResourceData } from "./build.ts";
import { LABEL_W, type DetailTabId } from "./detail.ts";

/**
 * Detail views for pods, images, volumes and networks (P4-T1..T4). Pure.
 *
 * Every field read here is present in a recorded fixture
 * (`pod-inspect.json`, `image-inspect.json`, `image-history.json`,
 * `volume-inspect.json`, `network-inspect-connected.json`). Rows use the
 * Config tab's conventions (`# Section`, a LABEL_W key column), so the
 * renderer paints them the same way.
 */

export interface TabMeta {
  id: DetailTabId;
  label: string;
}

/** Which tabs each panel's detail has. Containers keep their five. */
export const TABS_BY_PANEL: Record<PanelId, readonly TabMeta[]> = {
  containers: [
    { id: "logs", label: "Logs" },
    { id: "stats", label: "Stats" },
    { id: "env", label: "Env" },
    { id: "config", label: "Config" },
    { id: "top", label: "Top" },
  ],
  pods: [
    { id: "config", label: "Config" },
    { id: "members", label: "Containers" },
  ],
  images: [
    { id: "config", label: "Config" },
    { id: "history", label: "History" },
  ],
  volumes: [{ id: "config", label: "Config" }],
  networks: [{ id: "config", label: "Config" }],
  quadlets: [{ id: "config", label: "Config" }],
};

/** Default tab per panel: what you most likely opened it for. */
export const DEFAULT_TAB: Record<PanelId, DetailTabId> = {
  containers: "config",
  pods: "config",
  images: "config",
  volumes: "config",
  networks: "config",
  quadlets: "config",
};

/** Inspect payloads, fetched for the selected item of the focused panel. */
export type ResourceDetailData =
  | { panel: "pods"; id: string; inspect: PodInspect }
  | { panel: "images"; id: string; inspect: ImageInspect; history: ImageHistoryEntry[] | null }
  | { panel: "volumes"; id: string; inspect: VolumeInspect; users: ContainerListItem[] }
  | { panel: "networks"; id: string; inspect: NetworkInspect };

export interface ResourceView {
  lines: string[];
  /** `lines[0]` is a sticky table header. */
  table?: boolean;
  hint?: string;
}

const row = (key: string, value: string): string => `${key.padEnd(LABEL_W)}${value}`;
const short = (id: string | undefined): string => (id ?? "").replace(/^sha256:/, "").slice(0, 12);
const orNone = (v: string | undefined | null): string => (v ? v : "(none)");
const list = (v: readonly string[] | null | undefined): string => (v && v.length > 0 ? v.join(" ") : "(none)");

function labels(l: Record<string, string> | null | undefined): string[] {
  const entries = Object.entries(l ?? {});
  if (entries.length === 0) return [row("Labels", "(none)")];
  return entries.sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v], i) => row(i === 0 ? "Labels" : "", `${k}=${v}`));
}

/** Container display name: list rows carry `Names[0]`. */
const containerName = (c: ContainerListItem): string => c.Names?.[0]?.replace(/^\//, "") || c.Id.slice(0, 12);

// ---------------------------------------------------------------- pods

export function podView(tab: DetailTabId, inspect: PodInspect): ResourceView {
  const members = inspect.Containers ?? [];
  if (tab === "members") {
    if (members.length === 0) return { lines: ["This pod has no containers."] };
    const nameW = Math.max(4, ...members.map((m) => m.Name.length));
    const lines = [
      `${"NAME".padEnd(nameW)}  ${"STATE".padEnd(10)}  ID`,
      ...members.map((m) => {
        const infra = m.Id === inspect.InfraContainerID ? "  (infra)" : "";
        return `${m.Name.padEnd(nameW)}  ${m.State.padEnd(10)}  ${short(m.Id)}${infra}`;
      }),
    ];
    return { lines, table: true, hint: `${members.length} container${members.length === 1 ? "" : "s"}` };
  }
  return {
    lines: [
      "# Pod",
      row("Name", inspect.Name),
      row("State", inspect.State),
      row("Id", short(inspect.Id)),
      row("Created", inspect.Created),
      row("Containers", String(inspect.NumContainers)),
      row("Infra", orNone(short(inspect.InfraContainerID))),
      row("Shared ns", list(inspect.SharedNamespaces)),
      row("Exit policy", orNone(inspect.ExitPolicy)),
      ...labels(inspect.Labels),
    ],
  };
}

// --------------------------------------------------------------- images

/** `RUN /bin/sh -c set -x   && foo` → `RUN set -x && foo`, one line. */
export function cleanCreatedBy(text: string): string {
  return text
    .replace(/\/bin\/sh -c #\(nop\)\s*/g, "")
    .replace(/\/bin\/sh -c /g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function imageView(
  tab: DetailTabId,
  inspect: ImageInspect,
  history: ImageHistoryEntry[] | null,
  data: ResourceData,
  now: number,
): ResourceView {
  if (tab === "history") {
    if (history === null) return { lines: ["Loading history…"] };
    if (history.length === 0) return { lines: ["No history recorded for this image."] };
    const lines = [
      `${"CREATED".padEnd(8)}  ${"SIZE".padStart(8)}  CREATED BY`,
      ...history.map((h) => {
        const age = formatAge(parsePodmanTime(h.Created) ?? Number.NaN, now) || "?";
        return `${age.padEnd(8)}  ${formatBytes(h.Size).padStart(8)}  ${cleanCreatedBy(h.CreatedBy) || "(empty)"}`;
      }),
    ];
    return { lines, table: true, hint: `${history.length} layer${history.length === 1 ? "" : "s"}` };
  }
  const users = data.containers.filter((c) => c.ImageID === inspect.Id);
  const cfg = inspect.Config;
  const ports = Object.keys(cfg?.ExposedPorts ?? {});
  return {
    lines: [
      "# Image",
      row("Tags", (inspect.RepoTags ?? []).length > 0 ? (inspect.RepoTags ?? []).map(shortenImageName).join(" ") : "<none> (untagged)"),
      row("Id", short(inspect.Id)),
      row("Created", inspect.Created),
      row("Size", formatBytes(inspect.Size ?? 0)),
      row("Platform", `${inspect.Os ?? "?"}/${inspect.Architecture ?? "?"}`),
      row("Layers", String(inspect.RootFS?.Layers?.length ?? 0)),
      "# Config",
      row("Entrypoint", list(cfg?.Entrypoint)),
      row("Cmd", list(cfg?.Cmd)),
      row("WorkingDir", orNone(cfg?.WorkingDir)),
      row("User", orNone(cfg?.User)),
      row("Ports", list(ports)),
      row("Env", `${(cfg?.Env ?? []).length} variables`),
      "# Used by",
      ...(users.length === 0
        ? [row("Containers", "(none)")]
        : users.map((c, i) => row(i === 0 ? "Containers" : "", `${containerName(c)} · ${c.State}`))),
    ],
  };
}

// -------------------------------------------------------------- volumes

export function volumeView(inspect: VolumeInspect, users: ContainerListItem[]): ResourceView {
  return {
    lines: [
      "# Volume",
      row("Name", inspect.Name),
      row("Driver", inspect.Driver),
      row("Scope", orNone(inspect.Scope)),
      row("Mountpoint", inspect.Mountpoint),
      row("Created", inspect.CreatedAt),
      ...labels(inspect.Labels),
      "# Used by",
      ...(users.length === 0
        ? [row("Containers", "(none: unused)")]
        : users.map((c, i) => row(i === 0 ? "Containers" : "", `${containerName(c)} · ${c.State}`))),
    ],
  };
}

// ------------------------------------------------------------- networks

/** Containers on a network: from the list (all states), IPs from inspect. */
export function networkMembers(inspect: NetworkInspect, data: ResourceData): { name: string; state: string; ip: string }[] {
  const ips = new Map<string, string>();
  for (const [id, ep] of Object.entries(inspect.containers ?? {})) {
    const ip = Object.values(ep.interfaces ?? {})
      .flatMap((i) => i.subnets ?? [])
      .map((s) => s.ipnet)
      .join(" ");
    ips.set(id, ip);
  }
  const fromList = data.containers.filter((c) => (c.Networks ?? []).includes(inspect.name));
  const out = fromList.map((c) => ({ name: containerName(c), state: c.State, ip: ips.get(c.Id) ?? "" }));
  // Attached per inspect but not (yet) in the list: still show them.
  for (const [id, ep] of Object.entries(inspect.containers ?? {})) {
    if (!fromList.some((c) => c.Id === id)) out.push({ name: ep.name, state: "", ip: ips.get(id) ?? "" });
  }
  return out;
}

export function networkView(inspect: NetworkInspect, data: ResourceData): ResourceView {
  const members = networkMembers(inspect, data);
  const subnets = inspect.subnets ?? [];
  return {
    lines: [
      "# Network",
      row("Name", inspect.name),
      row("Id", short(inspect.id)),
      row("Driver", inspect.driver),
      row("Interface", orNone(inspect.network_interface)),
      row("Created", inspect.created),
      row("Internal", String(inspect.internal)),
      row("DNS", String(inspect.dns_enabled)),
      row("IPv6", String(inspect.ipv6_enabled)),
      ...labels(inspect.labels),
      "# Subnets",
      ...(subnets.length === 0
        ? [row("Subnet", "(none)")]
        : subnets.map((s, i) => row(i === 0 ? "Subnet" : "", `${s.subnet}${s.gateway ? ` gw ${s.gateway}` : ""}`))),
      "# Containers",
      ...(members.length === 0
        ? [row("Connected", "(none)")]
        : members.map((m, i) =>
            row(i === 0 ? "Connected" : "", [m.name, m.state, m.ip].filter((x) => x !== "").join(" · ")),
          )),
    ],
  };
}

/** Build the view for a non-container panel. */
export function resourceView(
  tab: DetailTabId,
  detail: ResourceDetailData,
  data: ResourceData,
  now: number,
): ResourceView {
  switch (detail.panel) {
    case "pods":
      return podView(tab, detail.inspect);
    case "images":
      return imageView(tab, detail.inspect, detail.history, data, now);
    case "volumes":
      return volumeView(detail.inspect, detail.users);
    case "networks":
      return networkView(detail.inspect, data);
  }
}
