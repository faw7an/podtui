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
export type Breakpoint = "XL" | "L" | "M" | "S" | "TOO_SMALL";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanelLayout extends Rect {
  id: PanelId;
  /** Panel is focusable/present but reduced to a title strip. */
  collapsed: boolean;
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
}

export interface LayoutInput {
  cols: number;
  rows: number;
  visible: ReadonlySet<PanelId>;
  focused: PaneId;
  /** Pane rendered into the entire body (escape hatch for narrow terminals). */
  fullscreen?: PaneId | null;
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
  header?: Rect;
  tabs?: Rect;
  footer?: Rect;
  sidebar?: Rect;
  /** List/table panes, in display order. */
  panels: PanelLayout[];
  detail?: Rect;
  /** Shown instead of the grid when the terminal is too small. */
  message?: { text: string; tone: "warn" | "info" };
}

export function paneIdEquals(a: PaneId | null | undefined, b: PaneId): boolean {
  return a === b;
}

export function panelIdEquals(a: PanelId | null | undefined, b: PanelId): boolean {
  return a === b;
}

export function isPanelId(id: PaneId): id is PanelId {
  return (PANEL_IDS as readonly string[]).includes(id);
}
