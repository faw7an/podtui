import React, { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useInput } from "ink";
import { Screen } from "./components/Screen.tsx";
import { createPodmanEngine } from "../engine/podman.ts";
import { initialState, reducer, resolveEscape } from "./layout/layoutReducer.ts";
import { PANEL_IDS, isPanelId, type PanelId } from "./layout/types.ts";
import { defaultTheme } from "../theme/theme.ts";
import { EMPTY_DATA, buildFrameModel, type ResourceData } from "./view/build.ts";
import { PANEL_COLUMNS } from "./view/model.ts";

const SOCKET_PATH = process.env["PODTUI_SOCKET"] ?? "/tmp/podtui-dev/podman.sock";

const POLL_MS = 5000;

export { PANEL_COLUMNS };
export { shortenImageName } from "../util/format.ts";
export { formatBytes } from "../util/format.ts";

export const App = () => {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState());
  const [data, setData] = useState<ResourceData>(EMPTY_DATA);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());
  const [error, setError] = useState<string | undefined>(undefined);

  const fetchAll = useCallback(async () => {
    const engine = createPodmanEngine();
    try {
      const [containers, pods, images, volumes, networks] = await Promise.all([
        engine.listContainers(SOCKET_PATH, true),
        engine.listPods(SOCKET_PATH),
        engine.listImages(SOCKET_PATH, true),
        engine.listVolumes(SOCKET_PATH),
        engine.listNetworks(SOCKET_PATH),
      ]);
      setData({ containers, pods, images, volumes, networks, quadlets: [] });
      setError(undefined);
      setLastRefresh(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch data");
    }
  }, []);

  useEffect(() => {
    void fetchAll();
    const id = setInterval(() => void fetchAll(), POLL_MS);
    return () => clearInterval(id);
  }, [fetchAll]);

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
  const focusCount = focusModel?.items.length ?? 0;

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

    // Selection navigation, clamped to the focused panel's item count.
    if (key.upArrow || input === "k") {
      dispatch({ type: "moveSelection", delta: -1 });
      return;
    }
    if (key.downArrow || input === "j") {
      dispatch({ type: "moveSelection", delta: 1 });
      return;
    }

    // Keep the selection inside the list when the data set shrinks.
    const current = state.selected[focusId] ?? 0;
    if (focusCount > 0 && current > focusCount - 1) {
      dispatch({ type: "select", id: focusId, index: focusCount - 1 });
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
