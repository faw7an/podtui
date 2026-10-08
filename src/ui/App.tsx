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
import { computeLayout } from "./layout/computeLayout.ts";
import { useLogStream } from "./hooks/useLogStream.ts";
import { FOLLOW, reduceLogView, type LogViewAction, type LogViewState } from "./view/logView.ts";
import { NO_SEARCH, findMatch, type LogSearchState } from "./view/logSearch.ts";
import { errorsOnly } from "./render/detailLines.ts";

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
  const [logView, setLogView] = useState<LogViewState>(FOLLOW);
  // Env secrets (P3-T6). Never carried to another container: see below.
  const [revealSecrets, setRevealSecrets] = useState(false);
  const [logSearch, setLogSearch] = useState<LogSearchState>(NO_SEARCH);
  // Display preferences survive switching containers; they are the user's.
  const [logOpts, setLogOpts] = useState({ timestamps: false, wrap: false, errorsOnly: false });

  const engine = useMemo(() => createPodmanEngine(), []);
  const fetchVisible = useMemo(
    () => createVisibleFetcher(engine, socketPath),
    [engine],
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

  // Same layout the Screen computes, needed here for two facts: whether the
  // detail pane is on screen at all (no pane, no stream) and how many log
  // rows it shows (a page is one screenful).
  const layout = useMemo(
    () =>
      computeLayout({
        cols: terminalCols,
        rows: terminalRows,
        visible: state.visible,
        focused: state.focus,
        zoom: state.zoom,
        detailFullscreen: state.detailFullscreen,
      }),
    [terminalCols, terminalRows, state.visible, state.focus, state.zoom, state.detailFullscreen],
  );
  // Detail rect minus its two borders and the tab strip.
  const logRows = Math.max(1, (layout.detail?.h ?? 3) - 3);

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
        revealSecrets,
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
      revealSecrets,
    ],
  );

  const focusId: PanelId = isPanelId(state.focus) ? state.focus : "containers";
  const focusModel = model.panels.find((p) => p.id === focusId);
  const selectedItemId = focusModel?.items[focusModel.selected]?.id ?? "";

  // A revealed secret stays revealed only for the container it was revealed
  // on: any change of selection hides secrets again.
  useEffect(() => setRevealSecrets(false), [selectedItemId]);

  // The Logs tab follows the selected container while the detail pane is on
  // screen. Anything else (another tab, another panel, no pane) is null, and
  // null closes the stream.
  const logContainerId =
    activeTab === "logs" && focusId === "containers" && layout.detail && selectedItemId
      ? selectedItemId
      : null;
  const logs = useLogStream(engine, socketPath, logContainerId, logContainerId !== null);

  // A new container or leaving the tab starts back at the live end.
  useEffect(() => {
    setLogView(FOLLOW);
    setLogSearch(NO_SEARCH);
  }, [logContainerId]);

  // Attached after the base model so the stream can depend on the selection
  // the model resolved (filtering included) without a cycle.
  const frameModel = useMemo(
    () =>
      logContainerId !== null && model.detail.lines.length === 0
        ? {
            ...model,
            detail: {
              ...model.detail,
              log: { source: logs.buffer, view: logView, status: logs.status, search: logSearch, ...logOpts },
            },
          }
        : model,
    // `logs.version` changes when the (mutable) buffer gains lines.
    [model, logContainerId, logs.buffer, logs.version, logs.status, logView, logSearch, logOpts],
  );

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
        const data = await engine.inspectContainer(socketPath, selectedItemId);
        if (!cancelled) setInspect(data);
      } catch {
        if (!cancelled) setInspect(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engine, focusId, selectedItemId]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      process.exit(0);
    }

    // --- Escape: dialog > help > zoom/fullscreen > filter > nothing ---
    // Single path for the whole priority chain; the filter branch below never
    // sees an Escape that a higher-priority state should consume first. A kept
    // (non-typing) filter on the focused panel counts as active, so Esc clears
    // it — at base Esc otherwise does nothing, so nothing is overwritten.
    // A log search being typed closes first; a kept one ranks with filters.
    const logSearchKept = frameModel.detail.log !== undefined && logSearch.query !== "";
    if (key.escape) {
      if (logSearch.typing) {
        setLogSearch(NO_SEARCH);
        return;
      }
      const action = resolveEscape(state, {
        helpOpen: state.help,
        filterActive:
          state.filterFor !== null ||
          (isPanelId(state.focus) && state.filterQuery[state.focus] !== undefined) ||
          logSearchKept,
        clearFilter: { type: "clearFilter" },
      });
      const listFilterKept = isPanelId(state.focus) && state.filterQuery[state.focus] !== undefined;
      if (action?.type === "clearFilter" && logSearchKept && state.filterFor === null && !listFilterKept) {
        setLogSearch(NO_SEARCH);
        return;
      }
      if (action) dispatch(action);
      return;
    }

    // --- Log search input (P3-T4): captures typing like the list filter. ---
    if (logSearch.typing) {
      const action = routeFilterKey(input, key);
      if (!action) return;
      if (action.type === "filterInput") {
        setLogSearch((s) => ({ ...s, query: s.query + action.text, current: null }));
      } else if (action.type === "filterBackspace") {
        setLogSearch((s) => ({ ...s, query: Array.from(s.query).slice(0, -1).join(""), current: null }));
      } else if (action.type === "clearFilterLine") {
        setLogSearch((s) => ({ ...s, query: "", current: null }));
      } else if (action.type === "endFilter") {
        // Enter keeps the query and jumps to the newest match, if any.
        const show = logOpts.errorsOnly ? errorsOnly : undefined;
        const seq = logSearch.query === "" ? null : findMatch(logs.buffer, logSearch.query, null, -1, show);
        setLogSearch((s) => (s.query === "" ? NO_SEARCH : { ...s, typing: false, current: seq }));
        if (seq !== null) setLogView((v) => reduceLogView(v, { type: "reveal", seq }, logs.buffer, logRows, show));
      }
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

    // --- Logs tab (P3-T2). Only while the tab actually shows a stream. ---
    // ↑↓jk scroll the log when the detail pane has focus; from a list they
    // keep moving the selection (handled further down).
    if (frameModel.detail.log) {
      const show = logOpts.errorsOnly ? errorsOnly : undefined;
      const logAction = (type: LogViewAction["type"]): void =>
        setLogView((v) => reduceLogView(v, { type } as LogViewAction, logs.buffer, logRows, show));
      if (input === "e") return setLogOpts((o) => ({ ...o, errorsOnly: !o.errorsOnly }));
      if (input === "t") return setLogOpts((o) => ({ ...o, timestamps: !o.timestamps }));
      if (input === "w") return setLogOpts((o) => ({ ...o, wrap: !o.wrap }));
      if ((input === "n" || input === "N") && logSearch.query !== "") {
        const seq = findMatch(logs.buffer, logSearch.query, logSearch.current, input === "n" ? 1 : -1, show);
        setLogSearch((s) => ({ ...s, current: seq }));
        if (seq !== null) setLogView((v) => reduceLogView(v, { type: "reveal", seq }, logs.buffer, logRows, show));
        return;
      }
      if (input === "p") return logAction("togglePause");
      if (input === "g") return logAction("top");
      if (input === "G") return logAction("bottom");
      if (key.pageUp) return logAction("pageUp");
      if (key.pageDown) return logAction("pageDown");
      if (state.focus === "detail") {
        if (key.upArrow || input === "k") return logAction("lineUp");
        if (key.downArrow || input === "j") return logAction("lineDown");
      }
    }

    if (input === "?") {
      dispatch({ type: "toggleHelp" });
      return;
    }

    // `/` searches the log when the detail pane has focus on the Logs tab, and
    // filters the focused list otherwise (DECISIONS phase-2/P2-T5).
    if (input === "/" && frameModel.detail.log && state.focus === "detail") {
      setLogSearch({ typing: true, query: "", current: null });
      return;
    }
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
    // `v` reveals/hides masked Env values; only on the Env tab, so it can
    // never flip secrets on while they are not even on screen.
    if (input === "v" && activeTab === "env") {
      setRevealSecrets((r) => !r);
      return;
    }

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
      model={frameModel}
      theme={defaultTheme}
      visible={state.visible}
      zoom={state.zoom}
      detailFullscreen={state.detailFullscreen}
      hintContext={
        state.filterFor !== null || logSearch.typing
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
