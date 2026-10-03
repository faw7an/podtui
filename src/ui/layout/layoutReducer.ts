import { PANEL_IDS, isPanelId, type PaneId, type PanelId } from "./types";
import { toggleAllSections } from "../view/detail.ts";

export type Action =
  | { type: "toggle"; id: PanelId }
  | { type: "focus"; id: PaneId }
  | { type: "move"; dir: 1 | -1 }
  /** `z` */
  | { type: "zoom" }
  /** `Enter` on a list item */
  | { type: "openDetail" }
  /** `Esc` */
  | { type: "escape" }
  | { type: "nextTab" }
  | { type: "prevTab" }
  /** Number keys 1-6: switch focus, or toggle when already focused. */
  | { type: "activate"; id: PanelId }
  /** Handled by the App's dialog/menu owner, highest Escape priority. */
  | { type: "closeDialog" }
  /** `?` toggles the help overlay. */
  | { type: "toggleHelp" }
  /** Select an item by its stable ID (never by row index). */
  | { type: "select"; id: PanelId; itemId: string }
  /** `/`: the focused panel starts capturing typing. */
  | { type: "startFilter" }
  /** Text typed while a filter is active. */
  | { type: "filterInput"; text: string }
  /** Backspace while a filter is active. */
  | { type: "filterBackspace" }
  /** `Esc` while a filter is active: drop the query and leave filter mode. */
  | { type: "clearFilter" }
  /** `Enter` while a filter is active: keep the query, leave filter mode. */
  | { type: "endFilter" }
  /** `Space` in the detail pane: fold or unfold every Config section. */
  | { type: "toggleAllSections" }
  /** `PgUp`/`PgDn` in the detail pane: scroll by roughly half a pane. */
  | { type: "detailScroll"; dir: 1 | -1 }
  /** Selection, tab and filter changes return the detail to the top. */
  | { type: "resetDetailScroll" };

export interface LayoutState {
  visible: Set<PanelId>;
  focus: PaneId;
  /** `z`: pane that owns the whole body, or null. */
  zoom: PaneId | null;
  /** Mode S `Enter`: detail owns the whole body. */
  detailFullscreen: boolean;
  /**
   * Focus to restore when leaving detail full-screen. Populated on the way in
   * only, so a resize while in detail never overwrites it.
   */
  returnFocus: PaneId;
  tab: number;
  /** `?` help overlay visibility. Escape closes it before anything else. */
  help: boolean;
  /**
   * Per-panel selection, stored as the selected item's ID so a refresh cannot
   * move the cursor (PROJECT_GUIDE §3 data flow 4). The row index is resolved
   * at render time by `selectedIndex`.
   */
  selected: Record<PanelId, string>;
  /**
   * `/` filter: the panel currently capturing typing, or null. Queries are
   * remembered per panel so switching focus does not lose them; narrowing
   * itself happens in `buildPanelModels`, before the stored selection ID
   * resolves to a row.
   */
  filterFor: PanelId | null;
  filterQuery: Partial<Record<PanelId, string>>;
  /** Folded Config sections (P2-T7). Empty = everything expanded. */
  collapsed: ReadonlySet<string>;
  /** Detail content scroll offset in rows (P2-T7); clamped at render time. */
  detailScroll: number;
}

/** At least one list panel must stay visible (LAYOUT_SPEC §4). */
const MIN_VISIBLE = 1;

/**
 * PgUp/PgDn step in the detail pane: roughly half of a typical pane, so one
 * press visibly moves without losing place. The renderer clamps the top end
 * against the actual content length.
 */
export const DETAIL_SCROLL_PAGE = 10;

export function initialState(
  visible?: readonly PanelId[],
  focus: PaneId = "containers",
): LayoutState {
  const selected = {} as Record<PanelId, string>;
  for (const id of PANEL_IDS) selected[id] = "";
  return {
    visible: new Set(visible ?? PANEL_IDS),
    focus,
    zoom: null,
    detailFullscreen: false,
    returnFocus: focus,
    tab: 0,
    help: false,
    selected,
    filterFor: null,
    filterQuery: {},
    collapsed: new Set(),
    detailScroll: 0,
  };
}

/** Canonical order restricted to what is visible. */
export function visibleOrder(state: LayoutState): PanelId[] {
  return PANEL_IDS.filter((id) => state.visible.has(id));
}

/** Next visible panel after `after`, wrapping; `detail` last. */
function nextVisiblePanel(state: LayoutState, after: PanelId, dir: 1 | -1 = 1): PanelId {
  const order = visibleOrder(state);
  if (order.length === 0) return after;
  const idx = order.indexOf(after);
  if (idx === -1) return order[0] ?? after;
  return order[(idx + dir + order.length) % order.length] ?? after;
}

/** Move focus to `id` if it is currently visible. Used after a hide. */
function relocateFocus(state: LayoutState, hidden: PanelId): PaneId {
  if (state.focus !== hidden) return state.focus;
  return nextVisiblePanel(state, hidden, 1);
}

export function reducer(state: LayoutState, action: Action): LayoutState {
  switch (action.type) {
    case "toggle": {
      const next = new Set(state.visible);
      if (next.has(action.id)) {
        if (next.size <= MIN_VISIBLE) return state;
        next.delete(action.id);
      } else {
        next.add(action.id);
      }
      return {
        ...state,
        visible: next,
        focus: relocateFocus({ ...state, visible: next }, action.id),
        zoom: state.zoom && isPanelId(state.zoom) && !next.has(state.zoom) ? null : state.zoom,
      };
    }

    case "focus": {
      if (isPanelId(action.id) && !state.visible.has(action.id)) return state;
      // Entering detail remembers where to come back to.
      const returnFocus = action.id === "detail" && state.focus !== "detail" ? state.focus : state.returnFocus;
      return { ...state, focus: action.id, returnFocus };
    }

    case "move": {
      const order: PaneId[] = [...visibleOrder(state), "detail"];
      const idx = order.indexOf(state.focus);
      const next = idx === -1 ? order[0] : order[(idx + action.dir + order.length) % order.length];
      if (!next) return state;
      const returnFocus = next === "detail" && state.focus !== "detail" ? state.focus : state.returnFocus;
      return { ...state, focus: next, returnFocus };
    }

    case "activate": {
      // Number key on an unfocused, visible panel focuses it (mode S uses this
      // to switch panels). On the focused panel it toggles visibility.
      if (!state.visible.has(action.id)) {
        const next = new Set(state.visible);
        next.add(action.id);
        return { ...state, visible: next, focus: action.id };
      }
      if (state.focus !== action.id) return { ...state, focus: action.id };
      return reducer(state, { type: "toggle", id: action.id });
    }

    case "zoom": {
      if (state.detailFullscreen) return { ...state, zoom: state.zoom };
      const target = state.zoom ? null : state.focus;
      return { ...state, zoom: target };
    }

    case "openDetail": {
      if (state.detailFullscreen) return state;
      return {
        ...state,
        detailFullscreen: true,
        zoom: null,
        returnFocus: state.focus,
        focus: "detail",
      };
    }

    case "escape": {
      // See resolveEscape for the full priority chain; the App passes the
      // dialog/filter context it owns.
      if (state.zoom) return { ...state, zoom: null, focus: state.zoom };
      if (state.detailFullscreen) {
        return {
          ...state,
          detailFullscreen: false,
          focus: isPanelId(state.returnFocus) ? state.returnFocus : "containers",
        };
      }
      return state;
    }

    case "nextTab":
      return { ...state, tab: (state.tab + 1) % 6, zoom: null };
    case "prevTab":
      return { ...state, tab: (state.tab + 5) % 6, zoom: null };
    case "toggleHelp":
      return { ...state, help: !state.help };

    case "closeDialog":
      // Owned by the App (dialog/menu state lives there); the layout state is
      // unchanged by definition, since dialogs take priority over the frame.
      return state;

    case "select": {
      if (state.selected[action.id] === action.itemId) return state;
      return {
        ...state,
        selected: { ...state.selected, [action.id]: action.itemId },
        detailScroll: 0,
      };
    }

    case "toggleAllSections": {
      return { ...state, collapsed: toggleAllSections(state.collapsed) };
    }

    case "detailScroll": {
      return {
        ...state,
        detailScroll: Math.max(0, state.detailScroll + action.dir * DETAIL_SCROLL_PAGE),
      };
    }

    case "resetDetailScroll": {
      if (state.detailScroll === 0) return state;
      return { ...state, detailScroll: 0 };
    }

    case "startFilter": {
      // Only a list panel can be filtered. From fullscreen detail the key is
      // ignored: the frame shows no list, so there is nothing to narrow.
      if (!isPanelId(state.focus)) return state;
      return { ...state, filterFor: state.focus };
    }

    case "filterInput": {
      if (state.filterFor === null || action.text === "") return state;
      const prev = state.filterQuery[state.filterFor] ?? "";
      return {
        ...state,
        filterQuery: { ...state.filterQuery, [state.filterFor]: prev + action.text },
        detailScroll: 0,
      };
    }

    case "filterBackspace": {
      if (state.filterFor === null) return state;
      const prev = state.filterQuery[state.filterFor] ?? "";
      if (prev === "") return state;
      // Grapheme-safe: slicing code units would split emoji in half.
      const next = Array.from(prev).slice(0, -1).join("");
      const filterQuery = { ...state.filterQuery };
      if (next === "") delete filterQuery[state.filterFor];
      else filterQuery[state.filterFor] = next;
      return { ...state, filterQuery };
    }

    case "clearFilter": {
      if (state.filterFor === null) return state;
      const filterQuery = { ...state.filterQuery };
      delete filterQuery[state.filterFor];
      return { ...state, filterFor: null, filterQuery, detailScroll: 0 };
    }

    case "endFilter": {
      if (state.filterFor === null) return state;
      return { ...state, filterFor: null, detailScroll: 0 };
    }
  }
}

/**
 * Pure Escape priority chain (LAYOUT_SPEC §4):
 *
 *   dialog/menu  >  detail-fullscreen or zoom  >  filter/search  >  nothing
 *
 * Returns the action Escape should perform, or `null` when there is nothing
 * left to close. Kept pure so the order is testable without rendering a dialog.
 */
export interface EscapeContext {
  /** A modal dialog or bulk-action menu is open. */
  dialogOpen?: boolean;
  /** The `?` help overlay is open (highest priority after a dialog). */
  helpOpen?: boolean;
  /** A filter or search input has an active query. */
  filterActive?: boolean;
  /** Clears the filter/search; supplied by the caller that owns it. */
  clearFilter?: Action;
}

export function resolveEscape(
  state: LayoutState,
  ctx: EscapeContext = {},
): Action | null {
  if (ctx.dialogOpen) return { type: "closeDialog" };
  if (ctx.helpOpen) return { type: "toggleHelp" };
  if (state.zoom) return { type: "escape" };
  if (state.detailFullscreen) return { type: "escape" };
  if (ctx.filterActive && ctx.clearFilter) return ctx.clearFilter;
  return null;
}

/**
 * Resolve a stored item ID to a row index against the CURRENT item ids.
 * Falls back to the first row when the selection is empty or has vanished, so
 * the panel always has a valid row to highlight.
 */
export function selectedIndex(selectedId: string, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const idx = ids.indexOf(selectedId);
  return idx >= 0 ? idx : 0;
}
