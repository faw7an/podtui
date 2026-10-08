import type {
  ContainerListItem,
  ImageListItem,
  NetworkListItem,
  PodListItem,
  VolumeListItem,
} from "../../api/types.ts";
import { formatAge, formatBytes, healthSuffix, parsePodmanTime, shortenImageName, statusText, statusGlyph } from "../../util/format.ts";
import { PANEL_IDS, type PaneId, type PanelId } from "../layout/types.ts";
import { selectedIndex } from "../layout/layoutReducer.ts";
import { PANEL_COLUMNS, panelMeta, type DetailLogModel, type DetailStatsModel, type FrameModel, type PanelModel, type RowModel } from "./model.ts";
import { buildDetail, type DetailTabId } from "./detail.ts";
import { TOP_POLL_MS, topTable } from "./topView.ts";
import { TABS_BY_PANEL, resourceView, type ResourceDetailData } from "./resourceDetail.ts";
import type { TopStatus } from "../hooks/useTopPoll.ts";
import type { ContainerInspect } from "../../api/types.ts";

export interface ResourceData {
  containers: ContainerListItem[];
  pods: PodListItem[];
  images: ImageListItem[];
  volumes: VolumeListItem[];
  networks: NetworkListItem[];
  /**
   * Names of volumes nothing references (server `dangling` filter), or null
   * before the first fetch. "In use" = not in this list (P4-T3).
   */
  danglingVolumes: string[] | null;
  /** No quadlet source is wired yet; the panel stays empty rather than guessing. */
  quadlets: { id: string; name: string; status: string }[];
}

export const EMPTY_DATA: ResourceData = {
  containers: [],
  pods: [],
  images: [],
  volumes: [],
  networks: [],
  danglingVolumes: null,
  quadlets: [],
};

/** Image list: repo tag if present, otherwise the bare id. */
function imageName(image: ImageListItem): string {
  const tag = image.RepoTags?.[0];
  if (tag) return shortenImageName(tag);
  const name = image.Names?.[0];
  if (name) return shortenImageName(name);
  // Untagged (RepoTags null, no Names — fixture images-list-untagged.json).
  return `<none> ${image.Id.slice(0, 12)}`;
}

function containerRows(items: ContainerListItem[], now: number): RowModel[] {
  return items.map((c) => {
    const st = statusText(c.State ?? "unknown");
    const health = healthSuffix(c.Status);
    return {
      id: c.Id,
      tone: health.tone ?? st.tone,
      cells: {
        name: c.Names?.[0]?.replace(/^\//, "") || c.Id.slice(0, 12),
        state: health.suffix ? `${st.text} ${health.suffix}` : st.text,
        image: shortenImageName(c.Image ?? ""),
        age: formatAge(parsePodmanTime(c.Created) ?? NaN, now),
      },
    };
  });
}

function podRows(items: PodListItem[], now: number): RowModel[] {
  return items.map((p) => {
    const st = statusText(p.Status ?? "unknown");
    return {
      id: p.Id,
      tone: st.tone,
      cells: {
        name: p.Name || p.Id.slice(0, 12),
        state: st.text,
        count: String(p.Containers?.length ?? 0),
        age: formatAge(parsePodmanTime(p.Created) ?? NaN, now),
      },
    };
  });
}

/**
 * Image state (P4-T2): `Containers` is the list's own count of containers
 * using the image; an image without tags is marked `untagged`, the case
 * `image prune` targets. A glyph accompanies every word.
 */
function imageRows(items: ImageListItem[], now: number): RowModel[] {
  return items.map((i) => {
    const used = (i.Containers ?? 0) > 0;
    const untagged = (i.RepoTags ?? []).length === 0 && (i.Names ?? []).length === 0;
    const tone = used ? ("ok" as const) : untagged ? ("warn" as const) : ("dim" as const);
    const word = used ? "in use" : untagged ? "untagged" : "unused";
    return {
      id: i.Id,
      tone,
      cells: {
        name: imageName(i),
        state: `${statusGlyph(tone)} ${word}`,
        size: formatBytes(i.Size ?? 0),
        age: formatAge(parsePodmanTime(i.Created) ?? NaN, now),
      },
    };
  });
}

/**
 * "In use" means some container (running or stopped) references the volume:
 * NOT in the server's dangling list, the same rule `volume prune` uses.
 * `MountCount` is not usable — it read 0 for a volume mounted by a running
 * container (verified live, Podman 5.8.4). Unknown until fetched: `…`.
 */
function volumeRows(items: VolumeListItem[], dangling: string[] | null): RowModel[] {
  const unused = dangling ? new Set(dangling) : null;
  return items.map((v) => {
    const inUse = unused ? !unused.has(v.Name) : null;
    return {
      id: v.Name,
      tone: inUse ? ("ok" as const) : ("dim" as const),
      cells: {
        name: v.Name,
        state: inUse === null ? `${statusGlyph("dim")} …` : `${statusGlyph(inUse ? "ok" : "dim")} ${inUse ? "in use" : "unused"}`,
        mountpoint: v.Mountpoint ?? "",
      },
    };
  });
}

/**
 * Network rows (P4-T4): driver, first subnet, and how many containers (any
 * state) list this network — the containers list's `Networks` names it.
 */
function networkRows(items: NetworkListItem[], containers: ContainerListItem[]): RowModel[] {
  return items.map((n) => {
    const count = containers.filter((c) => (c.Networks ?? []).includes(n.name)).length;
    return {
      id: n.id || n.name,
      tone: "info" as const,
      cells: {
        name: n.name,
        state: n.driver || "bridge",
        subnet: n.subnets?.[0]?.subnet ?? "",
        count: String(count),
      },
    };
  });
}

function quadletRows(items: { id: string; name: string; status: string }[]): RowModel[] {
  return items.map((q) => {
    const st = statusText(q.status);
    return {
      id: q.id,
      tone: st.tone,
      cells: { name: q.name, state: st.text },
    };
  });
}

/**
 * Narrow rows to those with a displayed cell containing the query
 * (case-insensitive, literal substring — never a pattern, so "." and "["
 * match only themselves). Every cell in `cells` is a shown column, so this is
 * exactly "the fields currently shown", whatever the panel. Applied before the
 * stored selection ID resolves to a row, so R-12's cursor stability and the
 * detail pane follow automatically — and the stored ID is never touched, so
 * clearing the query restores the cursor exactly.
 */
export function applyFilter(rows: RowModel[], query: string | undefined): RowModel[] {
  if (query === undefined || query === "") return rows;
  const needle = query.toLowerCase();
  return rows.filter((r) =>
    Object.values(r.cells).some((cell) => (cell ?? "").toLowerCase().includes(needle)),
  );
}

export function buildPanelModels(
  data: ResourceData,
  selected: Record<PanelId, string>,
  now: number,
  filter?: Partial<Record<PanelId, string>>,
): PanelModel[] {
  const rows: Record<PanelId, RowModel[]> = {
    containers: containerRows(data.containers, now),
    pods: podRows(data.pods, now),
    images: imageRows(data.images, now),
    volumes: volumeRows(data.volumes, data.danglingVolumes),
    networks: networkRows(data.networks, data.containers),
    quadlets: quadletRows(data.quadlets),
  };

  return PANEL_IDS.map((id) => {
    const query = filter?.[id];
    const items = applyFilter(rows[id], query);
    const meta = panelMeta(id);
    return {
    id,
    ...meta,
    // The title stays clean (redesigned filter UX moved the query to the
    // badge); the filter field below feeds title counts, badge, border and
    // header marker at render time. An empty query still sets the field: it
    // means "popup open but unfiltered", which is what makes `/` alone show
    // the popup instead of waiting for the first keystroke.
    title: meta.title,
    filter: query !== undefined ? { query, total: rows[id].length } : undefined,
    columns: PANEL_COLUMNS[id],
    items,
    // Resolve the stored item ID to the row index for this render.
    selected: selectedIndex(selected[id] ?? "", items.map((r) => r.id)),
    // Quadlets has no data source until Phase 6. Say so explicitly instead of
    // showing an empty box that looks like a bug; no fake data is invented.
    ...(id === "quadlets" && rows.quadlets.length === 0
      ? { emptyLabel: "not implemented yet (phase 6)" }
      : {}),
  };
  });
}

export interface BuildFrameArgs {
  data: ResourceData;
  selected: Record<PanelId, string>;
  focus: PaneId;
  now: number;
  clock: string;
  error?: string;
  /** Which detail tab is active (P2-T7). */
  activeTab?: DetailTabId;
  /** Inspect payload for the selected container, when available. */
  inspect?: ContainerInspect | null;
  /** Per-panel `/` filter queries; absent or empty means unfiltered. */
  filter?: Partial<Record<PanelId, string>>;
  collapsedSections?: ReadonlySet<string>;
  revealSecrets?: boolean;
  /** Logs tab stream for the selected container (P3-T2). */
  log?: DetailLogModel;
  /** Stats tab stream for the selected container (P3-T7). */
  stats?: DetailStatsModel;
  /** Top tab snapshot for the selected container (P3-T8). */
  top?: { status: TopStatus; state: string; name: string };
  /** Inspect data for a selected pod/image/volume/network (P4-T1..T4). */
  resource?: ResourceDetailData | null;
  /** The list whose selection the detail shows (defaults: focus, else containers). */
  detailPanel?: PanelId;
}

export function buildFrameModel(args: BuildFrameArgs): FrameModel {
  const panels = buildPanelModels(args.data, args.selected, args.now, args.filter);

  // Detail shows whatever is selected in the focused list panel.
  // Detail shows the selection of `detailPanel` (the list the user came from
  // when the detail pane has focus); older callers fall back to containers.
  const focusId: PanelId = args.detailPanel ?? (args.focus === "detail" ? "containers" : args.focus);
  const panel = panels.find((p) => p.id === focusId);
  const item = panel?.items[panel.selected];

  // With a real inspect payload the Config tab renders formatted sections;
  // otherwise fall back to the list row's own cells so the pane is never blank.
  const inspect = args.inspect ?? null;
  const detail = item
    ? buildDetail({
        inspect,
        activeTab: args.activeTab ?? "config",
        hasSelection: true,
        collapsed: args.collapsedSections,
        revealSecrets: args.revealSecrets,
        links: {
          podName: args.data.pods.find((p) => p.Id === inspect?.Pod)?.Name,
          // Null until the network list is loaded: then trust inspect as-is.
          networkNames: args.data.networks.length > 0 ? args.data.networks.map((n) => n.name) : undefined,
        },
      })
    : buildDetail({ inspect: null, activeTab: args.activeTab ?? "config", hasSelection: false });

  // Pods, images, volumes, networks (P4-T1..T4): their own tabs, built from
  // inspect data fetched for exactly this item.
  if (focusId !== "containers" && focusId !== "quadlets" && item) {
    const tabs = TABS_BY_PANEL[focusId];
    const wanted = args.activeTab ?? "config";
    const idx = Math.max(0, tabs.findIndex((t) => t.id === wanted));
    const tab = tabs[idx]?.id ?? "config";
    const resource = args.resource && args.resource.panel === focusId && args.resource.id === item.id ? args.resource : null;
    const view = resource ? resourceView(tab, resource, args.data, args.now) : { lines: ["Loading…"] };
    const state = (item.cells["state"] ?? "").replace(/^\S+ /, "");
    return {
      panels,
      focus: args.focus,
      clock: args.clock,
      error: args.error,
      detail: {
        title: `${item.cells["name"] ?? item.id.slice(0, 12)}${state ? ` · ${state}` : ""}`,
        tabs: tabs.map((t) => t.label),
        activeTab: idx,
        lines: view.lines,
        ...(view.table ? { table: true } : {}),
        ...(view.hint ? { hint: view.hint } : {}),
      },
    };
  }

  // The list is re-polled; inspect is fetched once per selection. So the
  // title takes the name from inspect but the state from the list: a
  // container stopped while selected must not keep saying "running".
  if (item && inspect && focusId === "containers") {
    const state = (item.cells["state"] ?? "").slice(2);
    if (state) detail.title = `${inspect.Name || inspect.Id.slice(0, 12)} · ${state}`;
  }

  // Top: a polled process table for a running container (P3-T8).
  if ((args.activeTab ?? "config") === "top") {
    if (focusId === "containers" && item) {
      if (!inspect) detail.title = `${item.cells["name"] ?? ""} · ${(item.cells["state"] ?? "").slice(2)}`;
      const top = args.top;
      if (!top) detail.lines = ["Loading processes…"];
      else if (top.state !== "running") {
        detail.lines = [`${top.name} is not running (${top.state || "unknown"}).`, "Processes are shown for running containers."];
      } else if (top.status.kind === "error") detail.lines = [`Processes unavailable: ${top.status.message}`];
      else if (top.status.kind !== "ok") detail.lines = ["Loading processes…"];
      else {
        const table = topTable(top.status.top);
        detail.lines = table.lines;
        detail.table = true;
        detail.hint = `${table.processes} process${table.processes === 1 ? "" : "es"} · every ${TOP_POLL_MS / 1000} s`;
      }
    } else if (item) {
      detail.lines = ["Processes are shown for containers. Select one in the Containers panel (2)."];
    }
    return { panels, focus: args.focus, clock: args.clock, error: args.error, detail };
  }

  // Stats, like logs, belong to containers.
  if ((args.activeTab ?? "config") === "stats") {
    if (focusId === "containers" && item) {
      detail.lines = [];
      if (args.stats) detail.stats = args.stats;
      if (!inspect) detail.title = `${item.cells["name"] ?? ""} · ${(item.cells["state"] ?? "").slice(2)}`;
    } else if (item) {
      detail.lines = ["Stats are shown for containers. Select one in the Containers panel (2)."];
    }
    return { panels, focus: args.focus, clock: args.clock, error: args.error, detail };
  }

  // Logs belong to containers; other panels say so instead of looking empty.
  // The title still names the selection; the content is the stream.
  if ((args.activeTab ?? "config") === "logs") {
    if (focusId === "containers" && item) {
      detail.lines = [];
      if (args.log) detail.log = args.log;
      if (!inspect) detail.title = `${item.cells["name"] ?? ""} · ${(item.cells["state"] ?? "").slice(2)}`;
    } else if (item) {
      detail.lines = ["Logs are shown for containers. Select one in the Containers panel (2)."];
    }
    return { panels, focus: args.focus, clock: args.clock, error: args.error, detail };
  }

  if (item && !inspect) {
    for (const [key, value] of Object.entries(item.cells)) {
      detail.lines.push(`${key.padEnd(11)}${value}`);
    }
    detail.title = `${item.cells["name"] ?? ""} · ${(item.cells["state"] ?? "").slice(2)}`;
  }

  return {
    panels,
    focus: args.focus,
    clock: args.clock,
    error: args.error,
    detail,
  };
}