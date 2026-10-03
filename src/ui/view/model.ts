import { PANEL_IDS, type ColumnDef, type PaneId, type PanelId } from "../layout/types.ts";

/**
 * One row of a panel table. `cells` is keyed by column id so that
 * `computeColumns` can drop a column without losing the others' data.
 */
export interface RowModel {
  id: string;
  cells: Record<string, string>;
  /** Tone for the whole row's status cell, used for colour. */
  tone?: "ok" | "warn" | "error" | "info" | "dim";
}

export interface PanelModel {
  id: PanelId;
  /** Header number, 1-6. */
  number: number;
  title: string;
  short: string;
  columns: ColumnDef[];
  items: RowModel[];
  /** Selected row index; remembered per panel across hide/show. */
  selected: number;
  /**
   * Text shown when the panel has no rows. Set for panels with no data source
   * yet, so an unimplemented panel reads as a placeholder rather than a bug.
   */
  emptyLabel?: string;
  /**
   * Active `/` filter (redesigned filter UX). `matched` is always
   * `items.length`; `total` is the unfiltered row count, so the title renders
   * `3/6` and the badge `⌕ web (3/6)`. Absent = unfiltered.
   */
  filter?: { query: string; total: number };
}

export interface DetailModel {
  /** Title line, e.g. `web · running`. */
  title: string;
  tabs: string[];
  activeTab: number;
  lines: string[];
}

export interface FrameModel {
  /** All six panels, canonical order. Visibility comes from the Layout. */
  panels: PanelModel[];
  focus: PaneId;
  /** Right-hand header text, e.g. `9:40 PM`. */
  clock: string;
  error?: string;
  detail: DetailModel;
}

export function panelMeta(
  id: PanelId,
): { number: number; title: string; short: string } {
  const i = PANEL_IDS.indexOf(id);
  const titles: Record<PanelId, [string, string]> = {
    pods: ["Pods", "Pods"],
    containers: ["Containers", "Cont"],
    images: ["Images", "Imgs"],
    volumes: ["Volumes", "Vols"],
    networks: ["Networks", "Nets"],
    quadlets: ["Quadlets", "Quads"],
  };
  const [title, short] = titles[id];
  return { number: i + 1, title, short };
}

/**
 * Column specs, in display order, using only fields present in
 * test/fixtures (LAYOUT_SPEC §6: `NAME` flexes, low-priority columns drop
 * first). `minW` is the narrowest useful rendering of that column's data.
 */
export const PANEL_COLUMNS: Record<PanelId, ColumnDef[]> = {
  containers: [
    { id: "name", minW: 10, flex: 3, priority: 100 },
    { id: "state", minW: 9, priority: 90 },
    { id: "image", minW: 8, flex: 2, priority: 50 },
    { id: "age", minW: 4, priority: 10 },
  ],
  pods: [
    { id: "name", minW: 10, flex: 3, priority: 100 },
    { id: "state", minW: 9, priority: 90 },
    { id: "count", minW: 3, priority: 40 },
  ],
  images: [
    { id: "name", minW: 10, flex: 3, priority: 100 },
    { id: "size", minW: 7, priority: 80 },
    { id: "age", minW: 4, priority: 20 },
  ],
  volumes: [
    { id: "name", minW: 10, flex: 3, priority: 100 },
    { id: "state", minW: 8, priority: 70 },
    { id: "mountpoint", minW: 10, flex: 2, priority: 30 },
  ],
  networks: [
    { id: "name", minW: 10, flex: 3, priority: 100 },
    { id: "state", minW: 8, priority: 70 },
  ],
  quadlets: [
    { id: "name", minW: 10, flex: 3, priority: 100 },
    { id: "state", minW: 9, priority: 80 },
  ],
};

/** Human header text per column id. */
export const COLUMN_HEADERS: Record<string, string> = {
  name: "NAME",
  state: "STATUS",
  image: "IMAGE",
  age: "AGE",
  size: "SIZE",
  count: "CNT",
  mountpoint: "MOUNTPOINT",
};
