import { PANEL_IDS, isPanelId, type PaneId, type PanelId } from "./types";

export type Action =
  | { type: "toggle"; id: PanelId }
  | { type: "focus"; id: PaneId }
  | { type: "fullscreen"; id: PaneId | null }
  | { type: "move"; dir: 1 | -1 }
  | { type: "nextTab" }
  | { type: "prevTab" };

export interface LayoutState {
  visible: Set<PanelId>;
  focus: PaneId;
  /** Pane that owns the whole content area, or null for the normal frame. */
  fullscreen: PaneId | null;
  tab: number;
}

/** Number of panels that must stay visible for the grid to make sense. */
const MIN_VISIBLE = 1;

export function initialState(visible?: readonly PanelId[]): LayoutState {
  return {
    visible: new Set(visible ?? PANEL_IDS),
    focus: "containers",
    fullscreen: null,
    tab: 0,
  };
}

/** Next visible panel in canonical order, wrapping around. */
function nextVisiblePanel(visible: ReadonlySet<PanelId>, after: PanelId): PanelId {
  const order = PANEL_IDS.filter((id) => visible.has(id));
  if (order.length === 0) return after;
  const idx = order.indexOf(after);
  return order[(idx + 1) % order.length] ?? after;
}

function clampFocus(focus: PaneId, visible: ReadonlySet<PanelId>): PaneId {
  if (focus === "detail") return focus;
  return visible.has(focus) ? focus : "containers";
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
      // Keep focus on something that exists.
      const focus = isPanelId(state.focus) && !next.has(state.focus) ? nextVisiblePanel(next, state.focus) : state.focus;
      const fullscreen = state.fullscreen && isPanelId(state.fullscreen) && !next.has(state.fullscreen) ? null : state.fullscreen;
      return { ...state, visible: next, focus, fullscreen };
    }
    case "focus":
      return { ...state, focus: action.id };
    case "fullscreen": {
      const closing = state.fullscreen === action.id;
      const focus = closing && action.id ? action.id : state.focus;
      return { ...state, fullscreen: closing ? null : action.id, focus };
    }
    case "move": {
      const order: PaneId[] = [...PANEL_IDS.filter((id) => state.visible.has(id)), "detail"];
      const idx = order.indexOf(state.focus);
      if (idx === -1) return { ...state, focus: order[0] ?? "detail" };
      const next = (idx + action.dir + order.length) % order.length;
      return { ...state, focus: order[next] ?? "detail" };
    }
    case "nextTab":
      return { ...state, tab: (state.tab + 1) % 6, fullscreen: null };
    case "prevTab":
      return { ...state, tab: (state.tab + 5) % 6, fullscreen: null };
  }
}

export { clampFocus };
