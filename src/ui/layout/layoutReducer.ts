import { PANEL_IDS, isPanelId, type PaneId, type PanelId } from "./types";

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
  /** Move the selection inside a panel; clamped by the caller to item count. */
  | { type: "select"; id: PanelId; index: number }
  | { type: "moveSelection"; delta: 1 | -1 };

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
  /** Per-panel selection, remembered across hide/show (LAYOUT_SPEC §4). */
  selected: Record<PanelId, number>;
}

/** At least one list panel must stay visible (LAYOUT_SPEC §4). */
const MIN_VISIBLE = 1;

export function initialState(
  visible?: readonly PanelId[],
  focus: PaneId = "containers",
): LayoutState {
  const selected = {} as Record<PanelId, number>;
  for (const id of PANEL_IDS) selected[id] = 0;
  return {
    visible: new Set(visible ?? PANEL_IDS),
    focus,
    zoom: null,
    detailFullscreen: false,
    returnFocus: focus,
    tab: 0,
    selected,
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
    case "closeDialog":
      // Owned by the App (dialog/menu state lives there); the layout state is
      // unchanged by definition, since dialogs take priority over the frame.
      return state;

    case "select": {
      const index = Math.max(0, Math.floor(action.index));
      if (state.selected[action.id] === index) return state;
      return { ...state, selected: { ...state.selected, [action.id]: index } };
    }

    case "moveSelection": {
      const id = state.focus;
      if (!isPanelId(id)) return state;
      const next = Math.max(0, state.selected[id] + action.delta);
      return { ...state, selected: { ...state.selected, [id]: next } };
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
  if (state.zoom) return { type: "escape" };
  if (state.detailFullscreen) return { type: "escape" };
  if (ctx.filterActive && ctx.clearFilter) return ctx.clearFilter;
  return null;
}
