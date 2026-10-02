export const PANEL_IDS = [
  "pods",
  "containers",
  "images",
  "volumes",
  "networks",
  "quadlets",
] as const;

export type PanelId = (typeof PANEL_IDS)[number];
export type PaneId = PanelId | "detail";
/** LAYOUT_SPEC §8 calls this `Mode`; kept as `Breakpoint` to avoid shadowing. */
export type Breakpoint = "XL" | "L" | "M" | "S" | "TOO_SMALL";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanelLayout extends Rect {
  id: PanelId;
  /** True only for a borderless 1-row title strip, never a short box. */
  collapsed: boolean;
  /** False for 4-5 row panels, which drop the column header to gain a row. */
  showHeader: boolean;
  /** Mirrors the layout input so components and tests need no extra plumbing. */
  focused: boolean;
}

export interface ColumnDef {
  /**
   * Column key. This is a *table column* id (e.g. "name", "age", "state"),
   * not a panel id — the two namespaces are unrelated.
   */
  id: string;
  minW: number;
  /** Preferred width as a fraction of the remaining space. */
  flex?: number;
  /** Lower numbers are dropped first when space is scarce. */
  priority?: number;
  /**
   * Blank cells reserved after this column (LAYOUT_SPEC §6: gap = 1-2 spaces).
   * The gap is included in the column's width, so the row still sums exactly.
   */
  gap?: number;
}

export interface LayoutInput {
  cols: number;
  rows: number;
  /** Toggled-on list panels. */
  visible: ReadonlySet<PanelId>;
  focused: PaneId;
  /** `z`: this pane fills the whole body. */
  zoom?: PaneId | null;
  /** Used in mode S: `Enter` opens detail full-screen. */
  detailFullscreen?: boolean;
  /** Column definitions from the active tab's view model. */
  columns?: readonly ColumnDef[];
  /**
   * How many content rows each panel would like to display, excluding its
   * chrome. Drives "expand to fit" height allocation.
   */
  demands?: ReadonlyMap<PanelId, number>;
}

export interface Layout {
  cols: number;
  rows: number;
  breakpoint: Breakpoint;
  /** Every rect is clipped to this region. Nothing may be drawn outside it. */
  content: Rect;
  /** One row: brand + tab numbers + clock (LAYOUT_SPEC §3). */
  header?: Rect;
  /** One row: key hints. */
  footer?: Rect;
  /** The list/table region, whether a sidebar (XL/L), a band (M) or none (S). */
  list?: Rect;
  /** Visible panels, in canonical display order. */
  panels: PanelLayout[];
  /**
   * Always present when there is room (LAYOUT_SPEC §4). Absent only when the
   * terminal is TOO_SMALL or when the mode cannot fit the minimum width.
   */
  detail?: Rect;
  /** Shown instead of the grid when the terminal is too small. */
  message?: { text: string; tone: "warn" | "info" };
}

export function isPanelId(id: PaneId): id is PanelId {
  return (PANEL_IDS as readonly string[]).includes(id);
}
