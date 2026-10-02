import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useInput } from "ink";
import { Screen } from "./components/Screen.tsx";
import { createPodmanEngine } from "../engine/podman.ts";
import { initialState, reducer, resolveEscape, selectedIndex } from "./layout/layoutReducer.ts";
import { PANEL_IDS, isPanelId, type PanelId } from "./layout/types.ts";
import { defaultTheme } from "../theme/theme.ts";
import { EMPTY_DATA, buildFrameModel, type ResourceData } from "./view/build.ts";
import { createVisibleFetcher } from "./view/refresh.ts";
import { PANEL_COLUMNS } from "./view/model.ts";

const SOCKET_PATH = process.env["PODTUI_SOCKET"] ?? "/tmp/podtui-dev/podman.sock";

const POLL_MS = 5000;

/**
 * Next/previous item id in `ids`, clamped at both ends. With nothing selected
 * yet, the first keypress lands on the first row rather than skipping it.
 */
function selectionStep(
  panel: PanelId,
  ids: readonly string[],
  currentId: string,
  delta: 1 | -1,
): { type: "select"; id: PanelId; itemId: string } {
  if (ids.length === 0) return { type: "select", id: panel, itemId: "" };
  // Nothing selected yet: the first keypress selects the first row.
  const next =
    currentId === ""
      ? 0
      : Math.min(ids.length - 1, Math.max(0, selectedIndex(currentId, ids) + delta));
  return { type: "select", id: panel, itemId: ids[next] ?? "" };
}

export { PANEL_COLUMNS };
export { shortenImageName } from "../util/format.ts";
export { formatBytes } from "../util/format.ts";

export const App = () => {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState());
  const [data, setData] = useState<ResourceData>(EMPTY_DATA);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());
  const [error, setError] = useState<string | undefined>(undefined);
  // Kept in a ref so the poll interval always reads the latest resource data
  // without being torn down and re-created on every refresh.
  const dataRef = useRef<ResourceData>(EMPTY_DATA);

  const fetchVisible = useMemo(
    () => createVisibleFetcher(createPodmanEngine(), SOCKET_PATH),
    [],
  );

  // Only panels that are visible are fetched (FR-3); hidden panels keep their
  // last known data and stop polling.
  const refresh = useCallback(async () => {
    const visible = state.visible;
    try {
      const { data, error } = await fetchVisible(visible, dataRef.current);
      dataRef.current = data;
      setData(data);
      setError(error);
      setLastRefresh(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch data");
    }
  }, [fetchVisible, state.visible]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const model = useMemo(
    () =>
      buildFrameModel({
        data,
        selected: state.selected,
        focus: state.focus,
        now: Date.now(),
        clock: new Date(lastRefresh).toLocaleTimeString(),
        error,
      }),
    [data, state.selected, state.focus, lastRefresh, error],
  );

  const focusId: PanelId = isPanelId(state.focus) ? state.focus : "containers";
  const focusModel = model.panels.find((p) => p.id === focusId);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      process.exit(0);
    }
    if (input === "q") {
      process.exit(0);
    }

    // --- Escape: dialog > zoom/fullscreen > filter > nothing ---
    if (key.escape) {
      const action = resolveEscape(state, {});
      if (action) dispatch(action);
      return;
    }

    if (key.return) {
      dispatch({ type: "openDetail" });
      return;
    }

    if (input === "z") {
      dispatch({ type: "zoom" });
      return;
    }

    if (key.tab) {
      dispatch({ type: "move", dir: key.shift ? -1 : 1 });
      return;
    }

    if (input >= "1" && input <= "6") {
      const id = PANEL_IDS[Number.parseInt(input, 10) - 1];
      if (id) dispatch({ type: "activate", id });
      return;
    }

    // Selection navigation. The reducer stores an item ID, so the neighbour is
    // resolved here where the current item list is known.
    const ids = focusModel?.items.map((i) => i.id) ?? [];
    if (key.upArrow || input === "k") {
      dispatch(selectionStep(focusId, ids, state.selected[focusId] ?? "", -1));
      return;
    }
    if (key.downArrow || input === "j") {
      dispatch(selectionStep(focusId, ids, state.selected[focusId] ?? "", 1));
      return;
    }
  });

  return (
    <Screen
      model={model}
      theme={defaultTheme}
      visible={state.visible}
      zoom={state.zoom}
      detailFullscreen={state.detailFullscreen}
    />
  );
};
