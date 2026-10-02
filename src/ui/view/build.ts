import type {
  ContainerListItem,
  ImageListItem,
  NetworkListItem,
  PodListItem,
  VolumeListItem,
} from "../../api/types.ts";
import { formatAge, formatBytes, parsePodmanTime, shortenImageName, statusText, statusGlyph } from "../../util/format.ts";
import { PANEL_IDS, type PaneId, type PanelId } from "../layout/types.ts";
import { selectedIndex } from "../layout/layoutReducer.ts";
import { PANEL_COLUMNS, panelMeta, type FrameModel, type PanelModel, type RowModel } from "./model.ts";
import { buildDetail, type DetailTabId } from "./detail.ts";
import type { ContainerInspect } from "../../api/types.ts";

export interface ResourceData {
  containers: ContainerListItem[];
  pods: PodListItem[];
  images: ImageListItem[];
  volumes: VolumeListItem[];
  networks: NetworkListItem[];
  /** No quadlet source is wired yet; the panel stays empty rather than guessing. */
  quadlets: { id: string; name: string; status: string }[];
}

export const EMPTY_DATA: ResourceData = {
  containers: [],
  pods: [],
  images: [],
  volumes: [],
  networks: [],
  quadlets: [],
};

/** Image list: repo tag if present, otherwise the bare id. */
function imageName(image: ImageListItem): string {
  const tag = image.RepoTags?.[0];
  if (tag) return shortenImageName(tag);
  const name = image.Names?.[0];
  if (name) return shortenImageName(name);
  return image.Id.slice(0, 12);
}

function containerRows(items: ContainerListItem[], now: number): RowModel[] {
  return items.map((c) => {
    const st = statusText(c.State ?? "unknown");
    return {
      id: c.Id,
      tone: st.tone,
      cells: {
        name: c.Names?.[0]?.replace(/^\//, "") || c.Id.slice(0, 12),
        state: st.text,
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

function imageRows(items: ImageListItem[], now: number): RowModel[] {
  return items.map((i) => ({
    id: i.Id,
    tone: "dim" as const,
    cells: {
      name: imageName(i),
      size: formatBytes(i.Size ?? 0),
      age: formatAge(parsePodmanTime(i.Created) ?? NaN, now),
    },
  }));
}

function volumeRows(items: VolumeListItem[]): RowModel[] {
  return items.map((v) => {
    const inUse = (v.MountCount ?? 0) > 0;
    return {
      id: v.Name,
      tone: inUse ? ("ok" as const) : ("dim" as const),
      cells: {
        name: v.Name,
        state: `${statusGlyph(inUse ? "ok" : "dim")} ${inUse ? "in use" : "unused"}`,
        mountpoint: v.Mountpoint ?? "",
      },
    };
  });
}

function networkRows(items: NetworkListItem[]): RowModel[] {
  return items.map((n) => ({
    id: n.id || n.name,
    tone: "info" as const,
    cells: { name: n.name, state: n.driver || "bridge" },
  }));
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

export function buildPanelModels(
  data: ResourceData,
  selected: Record<PanelId, string>,
  now: number,
): PanelModel[] {
  const rows: Record<PanelId, RowModel[]> = {
    containers: containerRows(data.containers, now),
    pods: podRows(data.pods, now),
    images: imageRows(data.images, now),
    volumes: volumeRows(data.volumes),
    networks: networkRows(data.networks),
    quadlets: quadletRows(data.quadlets),
  };

  return PANEL_IDS.map((id) => ({
    id,
    ...panelMeta(id),
    columns: PANEL_COLUMNS[id],
    items: rows[id],
    // Resolve the stored item ID to the row index for this render.
    selected: selectedIndex(selected[id] ?? "", rows[id].map((r) => r.id)),
    // Quadlets has no data source until Phase 6. Say so explicitly instead of
    // showing an empty box that looks like a bug; no fake data is invented.
    ...(id === "quadlets" && rows.quadlets.length === 0
      ? { emptyLabel: "not implemented yet (phase 6)" }
      : {}),
  }));
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
  collapsedSections?: ReadonlySet<string>;
  revealSecrets?: boolean;
}

export function buildFrameModel(args: BuildFrameArgs): FrameModel {
  const panels = buildPanelModels(args.data, args.selected, args.now);

  // Detail shows whatever is selected in the focused list panel.
  const focusId: PanelId = args.focus === "detail" ? "containers" : args.focus;
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
      })
    : buildDetail({ inspect: null, activeTab: args.activeTab ?? "config", hasSelection: false });

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