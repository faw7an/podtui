import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useInput } from "ink";
import { Screen } from "./components/Screen.tsx";
import { HelpOverlay } from "./components/HelpOverlay.tsx";
import { useTerminalSize } from "./hooks/useTerminalSize.ts";
import { createPodmanEngine } from "../engine/podman.ts";
import { initialState, reducer, resolveEscape, selectedIndex } from "./layout/layoutReducer.ts";
import { PANEL_IDS, isPanelId, type PanelId } from "./layout/types.ts";
import { defaultTheme } from "../theme/theme.ts";
import { EMPTY_DATA, buildFrameModel, type ResourceData } from "./view/build.ts";
import { createVisibleFetcher, startPollLoop } from "./view/refresh.ts";
import { DETAIL_TABS, nextTabIndex, type DetailTabId } from "./view/detail.ts";
import type { ContainerInspect } from "../api/types.ts";
import { PANEL_COLUMNS } from "./view/model.ts";
import { resolvePollMs } from "../config.ts";
import { routeFilterKey } from "../input/filterKeys.ts";

// FR-2 polling fallback. Configurable via PODTUI_POLL_MS; invalid values fall
// back to the default rather than reaching setInterval.
const POLL_MS = resolvePollMs(process.env["PODTUI_POLL_MS"]);

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

export const App = ({ socketPath }: { socketPath: string }) => {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState());
  const { columns: terminalCols, rows: terminalRows } = useTerminalSize();
  const [data, setData] = useState<ResourceData>(EMPTY_DATA);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());
  const [error, setError] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<DetailTabId>("config");
  const [inspect, setInspect] = useState<ContainerInspect | null>(null);
  // Kept in a ref so the poll interval always reads the latest resource data
  // without being torn down and re-created on every refresh.
  const dataRef = useRef<ResourceData>(EMPTY_DATA);

  const fetchVisible = useMemo(
    () => createVisibleFetcher(createPodmanEngine(), socketPath),
    [],
  );

  // Only panels that are visible are fetched (FR-3); hidden panels keep their
  // last known data and stop polling. One refresh at a time: the next starts
  // POLL_MS after the previous one settles, and a refresh still running when
  // the visible set changes drops its result (see startPollLoop).
  useEffect(
    () =>
      startPollLoop(async (isCurrent) => {
        try {
          const { data, error } = await fetchVisible(state.visible, dataRef.current);
          if (!isCurrent()) return;
          dataRef.current = data;
          setData(data);
          setError(error);
          setLastRefresh(Date.now());
        } catch (e) {
          if (isCurrent()) setError(e instanceof Error ? e.message : "Failed to fetch data");
        }
      }, POLL_MS),
    [fetchVisible, state.visible],
  );

  const model = useMemo(
    () =>
      buildFrameModel({
        data,
        selected: state.selected,
        focus: state.focus,
        now: Date.now(),
        clock: new Date(lastRefresh).toLocaleTimeString(),
        error,
        activeTab,
        inspect,
        filter: state.filterQuery,
        collapsedSections: state.collapsed,
      }),
    [
      data,
      state.selected,
      state.focus,
      lastRefresh,
      error,
      activeTab,
      inspect,
      state.filterQuery,
      state.collapsed,
    ],
  );

  const focusId: PanelId = isPanelId(state.focus) ? state.focus : "containers";
  const focusModel = model.panels.find((p) => p.id === focusId);
  const selectedItemId = focusModel?.items[focusModel.selected]?.id ?? "";

  // Inspect data feeds the Config tab. Fetched only for containers (the one
  // resource P2-T7 needs) and only when the selection actually changes.
  useEffect(() => {
    if (focusId !== "containers" || !selectedItemId) {
      setInspect(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const engine = createPodmanEngine();
        const data = await engine.inspectContainer(socketPath, selectedItemId);
        if (!cancelled) setInspect(data);
      } catch {
        if (!cancelled) setInspect(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusId, selectedItemId]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      process.exit(0);
    }

    // --- Escape: dialog > help > zoom/fullscreen > filter > nothing ---
    // Single path for the whole priority chain; the filter branch below never
    // sees an Escape that a higher-priority state should consume first. A kept
    // (non-typing) filter on the focused panel counts as active, so Esc clears
    // it — at base Esc otherwise does nothing, so nothing is overwritten.
    if (key.escape) {
      const action = resolveEscape(state, {
        helpOpen: state.help,
        filterActive:
          state.filterFor !== null ||
          (isPanelId(state.focus) && state.filterQuery[state.focus] !== undefined),
        clearFilter: { type: "clearFilter" },
      });
      if (action) dispatch(action);
      return;
    }

    // --- Filter mode (P2-T5): the focused panel captures typing. ---
    // Routed through the pure `routeFilterKey` so the "global keys are dead
    // inside the popup" contract is unit-testable without mounting anything.
    // In particular `q` and `?` type characters here — they must not quit or
    // open help, which is also why the footer hides those hints while filtering.
    if (state.filterFor !== null) {
      const action = routeFilterKey(input, key);
      if (action) dispatch(action);
      return;
    }

    if (input === "q") {
      process.exit(0);
    }

    if (input === "?") {
      dispatch({ type: "toggleHelp" });
      return;
    }

    // `/` filters the focused list; in the Phase 3 Logs tab the same key will
    // search instead. From fullscreen detail it is a no-op (see startFilter).
    if (input === "/") {
      dispatch({ type: "startFilter" });
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

    // [ / ] move through the detail tabs (FR-4).
    if (input === "[" || input === "]") {
      setActiveTab((prev) => {
        const idx = DETAIL_TABS.findIndex((t) => t.id === prev);
        return DETAIL_TABS[nextTabIndex(idx, input === "]" ? 1 : -1)]?.id ?? "config";
      });
      dispatch({ type: "resetDetailScroll" });
      return;
    }

    // Space folds/unfolds every Config section; PgUp/PgDn scroll the detail.
    // Both are inert while filtering (the filter branch above returns first),
    // where Space types a space and PgUp/PgDn have no text to append.
    if (input === " ") {
      dispatch({ type: "toggleAllSections" });
      return;
    }

    if (key.pageUp || key.pageDown) {
      dispatch({ type: "detailScroll", dir: key.pageUp ? -1 : 1 });
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

  // The help overlay replaces the frame while open.
  if (state.help) {
    return <HelpOverlay size={{ cols: terminalCols, rows: terminalRows }} />;
  }

  return (
    <Screen
      model={model}
      theme={defaultTheme}
      visible={state.visible}
      zoom={state.zoom}
      detailFullscreen={state.detailFullscreen}
      hintContext={
        state.filterFor !== null
          ? "filter"
          : isPanelId(state.focus) && state.filterQuery[state.focus] !== undefined
            ? "filterKept"
            : undefined
      }
      detailScroll={state.detailScroll}
      filterPopup={state.filterFor}
    />
  );
};
