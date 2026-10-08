import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useInput } from "ink";
import { Screen } from "./components/Screen.tsx";
import { HelpOverlay } from "./components/HelpOverlay.tsx";
import { useTerminalSize } from "./hooks/useTerminalSize.ts";
import { createPodmanEngine } from "../engine/podman.ts";
import { applyScope, emptyContainersNote, scopeLabel, type Scope } from "../engine/scope.ts";
import { bunRunner, createSystemd, type CommandRunner, type SystemdScope } from "../engine/systemd.ts";
import { initialState, reducer, resolveEscape, selectedIndex, shownPanels } from "./layout/layoutReducer.ts";
import { PANEL_IDS, isPanelId, type PanelId } from "./layout/types.ts";
import { defaultTheme, type Theme } from "../theme/theme.ts";
import { OMARCHY_THEME_DIRS, loadOmarchyTheme } from "../theme/omarchy.ts";
import { watch } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { EMPTY_DATA, buildFrameModel, type ResourceData } from "./view/build.ts";
import { createVisibleFetcher, startPollLoop } from "./view/refresh.ts";
import { nextTabIndex, type DetailTabId } from "./view/detail.ts";
import { DEFAULT_TAB, TABS_BY_PANEL, type ResourceDetailData } from "./view/resourceDetail.ts";
import type { ContainerInspect } from "../api/types.ts";
import { PANEL_COLUMNS, panelMeta } from "./view/model.ts";
import { resolvePollMs } from "../config.ts";
import { routeFilterKey } from "../input/filterKeys.ts";
import { computeLayout } from "./layout/computeLayout.ts";
import { useLineStream } from "./hooks/useLogStream.ts";
import { containerLogSource, journalSource } from "./view/logSession.ts";
import { useStatsStream } from "./hooks/useStatsStream.ts";
import { useTopPoll } from "./hooks/useTopPoll.ts";
import { FOLLOW, reduceLogView, type LogViewAction, type LogViewState } from "./view/logView.ts";
import { NO_SEARCH, findMatch, type LogSearchState } from "./view/logSearch.ts";
import { errorsOnly } from "./render/detailLines.ts";
import { looksLikeMouse, parseMouse, type MouseEvent } from "../input/mouse.ts";
import { hitTest } from "./layout/hitTest.ts";
import { dialogKey, openConfirm, openMessage, type DialogState } from "./view/confirmDialog.ts";
import { actionFor, failureContent, podJumpTarget, quadletJumpTarget } from "./actions/selectionAction.ts";
import { busyText, doneText, runAction, type ActionVerb, type ResourceAction } from "./actions/resourceActions.ts";
import type { Notice } from "./view/model.ts";
import { bulkKey, executed, openBulk, previewed, type BulkEffect, type BulkFlow } from "./bulk/bulkFlow.ts";
import { commandsFor, orderedCommands } from "./bulk/commands.ts";

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

/** `$HOME` first (as shells and Omarchy use it), else the OS account home. */
const homeDir = (): string => process.env["HOME"] || homedir();

/**
 * `runner` exists for tests: they pass a fake so nothing ever reaches the real
 * user systemd. Production uses the Bun.spawn runner.
 */
/** What the App shows: your containers, or everything (`--all`). */
export type AppScope = Scope;

export const App = ({
  socketPath,
  runner = bunRunner,
  scope: scopeMode = { kind: "all" },
}: {
  socketPath: string;
  runner?: CommandRunner;
  /** Default `all` keeps tests and embedders unchanged; the CLI decides. */
  scope?: AppScope;
}) => {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState());
  const { columns: terminalCols, rows: terminalRows } = useTerminalSize();
  // Everything the refresh loop fetched; what is SHOWN is `data`, narrowed
  // to the scope below.
  const [rawData, setData] = useState<ResourceData>(EMPTY_DATA);
  const viewScope: Scope = scopeMode;
  const data: ResourceData = useMemo(() => {
    const scoped = applyScope(viewScope, rawData);
    return { ...scoped, scopeNote: emptyContainersNote(viewScope, scoped.hiddenEnvironments) };
  }, [viewScope, rawData]);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());
  const [error, setError] = useState<string | undefined>(undefined);
  // Each panel remembers its own detail tab (P4: pods/images have their own).
  const [activeTabs, setActiveTabs] = useState<Record<PanelId, DetailTabId>>(DEFAULT_TAB);
  // Inspect data for a selected pod/image/volume/network (P4-T1..T4).
  const [resource, setResource] = useState<ResourceDetailData | null>(null);
  const [inspect, setInspect] = useState<ContainerInspect | null>(null);
  // Kept in a ref so the poll interval always reads the latest resource data
  // without being torn down and re-created on every refresh.
  const dataRef = useRef<ResourceData>(EMPTY_DATA);
  const [logView, setLogView] = useState<LogViewState>(FOLLOW);
  // Env secrets (P3-T6). Never carried to another container: see below.
  const [revealSecrets, setRevealSecrets] = useState(false);
  // Actions (P4-T5/T6): the open dialog, the footer notice, and a counter
  // that restarts the poll loop so a finished action shows at once.
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);
  const busyRef = useRef(false);
  // Panels fetched at least once: an empty panel hides only after its
  // first answer, so nothing flickers away while the app starts.
  const [loaded, setLoaded] = useState<ReadonlySet<PanelId>>(new Set());
  // The `x` bulk menu (P5). Results arrive through functional updates
  // (`previewed`/`executed`), which drop them if the user has moved on.
  const [bulk, setBulk] = useState<BulkFlow | null>(null);
  const [logSearch, setLogSearch] = useState<LogSearchState>(NO_SEARCH);
  // Display preferences survive switching containers; they are the user's.
  const [logOpts, setLogOpts] = useState({ timestamps: false, wrap: false, errorsOnly: false });

  const engine = useMemo(() => createPodmanEngine(), []);

  // Omarchy theme (P7-T4): loaded at startup, reloaded on `T`, and followed
  // when Omarchy switches theme. Switching REPLACES the theme directory, so
  // the watch is on its parent; events are debounced.
  const [theme, setTheme] = useState<Theme>(defaultTheme);
  const reloadTheme = async (announce: boolean): Promise<void> => {
    const r = await loadOmarchyTheme(homeDir());
    setTheme(r.theme);
    if (announce) {
      setNotice(
        r.kind === "omarchy"
          ? { tone: "ok", text: `theme: ${r.theme.name.replace(/^omarchy:/, "")}` }
          : { tone: "ok", text: `default theme (${r.reason})` },
      );
    }
  };
  useEffect(() => {
    void reloadTheme(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watchers = OMARCHY_THEME_DIRS(homeDir()).flatMap((dir) => {
      try {
        return [
          watch(dirname(dir), () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => void reloadTheme(false), 300);
          }),
        ];
      } catch {
        return []; // that location does not exist: nothing to follow
      }
    });
    return () => {
      if (timer) clearTimeout(timer);
      for (const w of watchers) w.close();
    };
  }, []);
  // Quadlet units live in the USER systemd for a rootless Podman and in the
  // system manager for a rootful one (P6); asked once, user until known.
  const [scope, setScope] = useState<SystemdScope>("user");
  useEffect(() => {
    void engine
      .getInfo(socketPath)
      .then((info) => setScope(info.host?.security?.rootless === false ? "system" : "user"))
      .catch(() => undefined);
  }, [engine]);
  const systemd = useMemo(() => createSystemd(runner, scope), [runner, scope]);
  const fetchVisible = useMemo(
    () => createVisibleFetcher(engine, socketPath, systemd.states),
    [engine, systemd],
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
          setLoaded((prev) => (PANEL_IDS.every((p) => !state.visible.has(p) || prev.has(p)) ? prev : new Set([...prev, ...state.visible])));
          setError(error);
          setLastRefresh(Date.now());
        } catch (e) {
          if (isCurrent()) setError(e instanceof Error ? e.message : "Failed to fetch data");
        }
      }, POLL_MS),
    [fetchVisible, state.visible, refreshKey],
  );

  // A result stays readable for a while, then gets out of the way. Busy
  // notices stay until the action settles.
  useEffect(() => {
    if (!notice || notice.tone === "busy") return;
    const t = setTimeout(() => setNotice(undefined), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  // Run what the bulk state machine asked for, and feed the result back.
  const runBulkEffect = (effect: BulkEffect | undefined): void => {
    if (!effect) return;
    const { command } = effect;
    const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
    if (effect.type === "preview") {
      void command
        .preview(engine, socketPath)
        .then((preview) => setBulk((f) => previewed(f, command, { preview })))
        .catch((e: unknown) => setBulk((f) => previewed(f, command, { error: message(e) })));
    } else {
      busyRef.current = true;
      void command
        .execute(engine, socketPath, effect.preview)
        .then((result) => setBulk((f) => executed(f, command, { result })))
        .catch((e: unknown) => setBulk((f) => executed(f, command, { error: message(e) })))
        .finally(() => {
          busyRef.current = false;
          setRefreshKey((k) => k + 1);
        });
    }
  };

  const perform = (action: ResourceAction): void => {
    busyRef.current = true;
    setNotice({ tone: "busy", text: busyText(action) });
    void runAction(engine, socketPath, action, systemd)
      .then((r) => setNotice({ tone: "ok", text: r.message ?? doneText(action) }))
      .catch((e: unknown) => {
        // A failed action answers something the user just asked for, so it
        // gets a dialog they must acknowledge, not a footer line that fades.
        const content = failureContent(action, e instanceof Error ? e.message : String(e), dataRef.current);
        setNotice(undefined);
        setDialog(openMessage(content.title, content.lines));
      })
      .finally(() => {
        busyRef.current = false;
        setRefreshKey((k) => k + 1);
      });
  };

  // Empty panels hide (their numbers stay); Containers always stays, since
  // its empty state explains how to start one. Refreshing keeps running for
  // hidden panels (it follows the user's own visible set), so they come back
  // by themselves when something appears.
  const emptyPanels = useMemo(() => {
    const count: Record<PanelId, number> = {
      pods: data.pods.length,
      containers: 1,
      images: data.images.length,
      volumes: data.volumes.length,
      networks: data.networks.length,
      quadlets: data.quadlets.length,
    };
    return PANEL_IDS.filter((p) => loaded.has(p) && count[p] === 0);
  }, [data, loaded]);
  const emptyKey = emptyPanels.join(",");
  useEffect(() => {
    dispatch({ type: "setAutoHidden", ids: emptyPanels });
  }, [emptyKey]);
  const shown = useMemo(() => shownPanels(state), [state.visible, state.autoHidden]);
  const emptyNotice = (id: PanelId): boolean => {
    if (!state.autoHidden.has(id)) return false;
    const title = panelMeta(id).title.toLowerCase();
    setNotice({ tone: "ok", text: `No ${title} yet: panel ${panelMeta(id).number} appears when there are some.` });
    return true;
  };

  // Same layout the Screen computes, needed here for two facts: whether the
  // detail pane is on screen at all (no pane, no stream) and how many log
  // rows it shows (a page is one screenful).
  const layout = useMemo(
    () =>
      computeLayout({
        cols: terminalCols,
        rows: terminalRows,
        visible: shown,
        focused: state.focus,
        zoom: state.zoom,
        detailFullscreen: state.detailFullscreen,
      }),
    [terminalCols, terminalRows, shown, state.focus, state.zoom, state.detailFullscreen],
  );
  // The list whose selection the detail pane shows: the focused list, or the
  // one the user came from when the detail pane itself has focus.
  const detailPanel: PanelId = isPanelId(state.focus)
    ? state.focus
    : isPanelId(state.returnFocus)
      ? state.returnFocus
      : "containers";
  const activeTab = activeTabs[detailPanel];

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
        scope: scopeLabel(viewScope),
        error,
        activeTab,
        inspect,
        filter: state.filterQuery,
        collapsedSections: state.collapsed,
        revealSecrets,
        detailPanel,
        resource,
      }),
    [
      viewScope,
      detailPanel,
      resource,
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

  const focusId: PanelId = detailPanel;
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
  // A quadlet's Journal tab streams its unit's journal through the same
  // machinery (P6-T3). One stream at a time: the key says which.
  const selectedQuadlet = focusId === "quadlets" ? data.quadlets.find((q) => q.id === selectedItemId) : undefined;
  const journalUnit = activeTab === "journal" && layout.detail && selectedQuadlet ? selectedQuadlet.unit : null;
  const streamKey = logContainerId ?? (journalUnit ? `journal:${journalUnit}` : null);
  const lineSource = useMemo(
    () =>
      logContainerId
        ? containerLogSource(engine, socketPath, logContainerId)
        : journalUnit
          ? journalSource(systemd, journalUnit)
          : null,
    [engine, logContainerId, journalUnit, systemd],
  );
  const logs = useLineStream(streamKey, lineSource);

  // Stats stream only for a RUNNING container on the Stats tab: a stopped
  // container's stream sends nothing but zeros (verified), so the tab shows
  // its state instead.
  const selectedContainer =
    focusId === "containers" ? data.containers.find((c) => c.Id === selectedItemId) : undefined;
  const statsContainerId =
    activeTab === "stats" && layout.detail && selectedContainer?.State === "running" ? selectedItemId : null;
  const stats = useStatsStream(engine, socketPath, statsContainerId, statsContainerId !== null);
  const topContainerId =
    activeTab === "top" && layout.detail && selectedContainer?.State === "running" ? selectedItemId : null;
  const top = useTopPoll(engine, socketPath, topContainerId, topContainerId !== null);

  // A new container or leaving the tab starts back at the live end.
  useEffect(() => {
    setLogView(FOLLOW);
    setLogSearch(NO_SEARCH);
  }, [streamKey]);

  // Attached after the base model so the stream can depend on the selection
  // the model resolved (filtering included) without a cycle.
  const frameModel = useMemo(
    () =>
      activeTab === "top" && selectedContainer
        ? buildFrameModel({
            data,
            selected: state.selected,
            focus: state.focus,
            now: Date.now(),
            clock: new Date(lastRefresh).toLocaleTimeString(),
        scope: scopeLabel(viewScope),
            error,
            activeTab,
            inspect,
            filter: state.filterQuery,
            collapsedSections: state.collapsed,
            revealSecrets,
            detailPanel,
            resource,
            top: {
              status: top,
              state: selectedContainer.State ?? "",
              name: selectedContainer.Names?.[0] ?? selectedItemId.slice(0, 12),
            },
          })
        : activeTab === "stats" && selectedContainer && model.detail.lines.length === 0
        ? {
            ...model,
            detail: {
              ...model.detail,
              stats: {
                history: stats.history,
                status: stats.status,
                state: selectedContainer.State ?? "",
                name: selectedContainer.Names?.[0] ?? selectedItemId.slice(0, 12),
              },
            },
          }
        : streamKey !== null && model.detail.lines.length === 0
        ? {
            ...model,
            detail: {
              ...model.detail,
              log: { source: logs.buffer, view: logView, status: logs.status, search: logSearch, ...logOpts },
            },
          }
        : model,
    // `logs.version` changes when the (mutable) buffer gains lines.
    [
      model,
      streamKey,
      logs.buffer,
      logs.version,
      logs.status,
      logView,
      logSearch,
      logOpts,
      activeTab,
      selectedContainer,
      selectedItemId,
      stats.history,
      stats.status,
      top,
      viewScope,
      data,
      state.selected,
      state.focus,
      lastRefresh,
      error,
      inspect,
      state.filterQuery,
      state.collapsed,
      revealSecrets,
    ],
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

  // Pods, images, volumes, networks: inspect (plus image history, volume
  // users) for the selected item. Refetched on every list refresh, because
  // what uses a volume or sits on a network changes while you look.
  useEffect(() => {
    if (focusId === "containers" || !selectedItemId || !layout.detail) {
      setResource(null);
      return;
    }
    let cancelled = false;
    const id = selectedItemId;
    void (async () => {
      try {
        let next: ResourceDetailData;
        if (focusId === "pods") next = { panel: "pods", id, inspect: await engine.inspectPod(socketPath, id) };
        else if (focusId === "images") {
          const [inspect, history] = await Promise.all([
            engine.inspectImage(socketPath, id),
            engine.imageHistory(socketPath, id).catch(() => []),
          ]);
          next = { panel: "images", id, inspect, history };
        } else if (focusId === "volumes") {
          const [inspect, users] = await Promise.all([
            engine.inspectVolume(socketPath, id),
            engine.containersUsingVolume(socketPath, id),
          ]);
          next = { panel: "volumes", id, inspect, users };
        } else if (focusId === "quadlets") {
          const q = dataRef.current.quadlets.find((x) => x.id === id);
          if (!q) return;
          const [file, unitText] = await Promise.all([
            engine.quadletFile(socketPath, id),
            // No systemd answer is not fatal: the File tab still shows.
            systemd.text(q.unit).catch(() => null),
          ]);
          next = { panel: "quadlets", id, unit: q.unit, file, unitText };
        } else next = { panel: "networks", id, inspect: await engine.inspectNetwork(socketPath, id) };
        if (!cancelled) setResource(next);
      } catch (e) {
        if (!cancelled) {
          setResource(null);
          setNotice({ tone: "error", text: e instanceof Error ? e.message : String(e) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engine, systemd, focusId, selectedItemId, lastRefresh, layout.detail !== null]);

  const shownModel = notice ? { ...frameModel, notice } : frameModel;

  // What a click or wheel notch does (P7-T8), resolved by hitTest against
  // the very layout and model on screen.
  const handleMouse = (ev: MouseEvent): void => {
    const hit = hitTest(layout, shownModel, theme, ev.x, ev.y);
    if (ev.kind === "wheel") {
      const dir = ev.direction === "up" ? -1 : 1;
      if (hit.kind === "panelRow" || hit.kind === "panelBody" || hit.kind === "panelTitle") {
        const panel = shownModel.panels.find((p) => p.id === hit.id);
        const ids = panel?.items.map((i) => i.id) ?? [];
        if (state.focus !== hit.id) dispatch({ type: "focus", id: hit.id });
        dispatch(selectionStep(hit.id, ids, state.selected[hit.id] ?? "", dir));
      } else if (hit.kind === "detailBody" || hit.kind === "detailTab") {
        if (frameModel.detail.log) {
          const show = logOpts.errorsOnly ? errorsOnly : undefined;
          const type = dir < 0 ? "lineUp" : "lineDown";
          setLogView((v) => [0, 1, 2].reduce((acc) => reduceLogView(acc, { type }, logs.buffer, logRows, show), v));
        } else {
          dispatch({ type: "detailScroll", dir });
        }
      }
      return;
    }
    if (ev.kind !== "press" || ev.button !== "left") return;
    switch (hit.kind) {
      case "headerTab":
        if (!emptyNotice(hit.id)) dispatch({ type: "activate", id: hit.id });
        return;
      case "panelNumber":
        dispatch({ type: "toggle", id: hit.id });
        return;
      case "panelTitle":
      case "panelBody":
        dispatch({ type: "focus", id: hit.id });
        return;
      case "panelRow":
        dispatch({ type: "focus", id: hit.id });
        dispatch({ type: "select", id: hit.id, itemId: hit.itemId });
        return;
      case "detailTab": {
        const tab = TABS_BY_PANEL[detailPanel][hit.index];
        if (tab) {
          setActiveTabs((prev) => ({ ...prev, [detailPanel]: tab.id }));
          dispatch({ type: "resetDetailScroll" });
        }
        return;
      }
      case "detailBody":
        if (state.focus !== "detail") dispatch({ type: "focus", id: "detail" });
        return;
      case "none":
        return;
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      process.exit(0);
    }

    // --- Mouse (P7-T8). A report is never typing, whatever mode is open. ---
    if (looksLikeMouse(input)) {
      const ev = parseMouse(input);
      // Click outside a modal (or anywhere while typing) does nothing.
      const modal = dialog !== null || bulk !== null || state.help || state.filterFor !== null || logSearch.typing;
      if (ev && !modal) handleMouse(ev);
      return;
    }

    // --- Bulk menu (P5): owns every key while open. ---
    if (bulk) {
      const step = bulkKey(bulk, input, key);
      setBulk(step.flow);
      runBulkEffect(step.effect);
      return;
    }

    // --- Confirm dialog (P4-T6): owns every key while open. ---
    if (dialog) {
      const outcome = dialogKey(dialog, input, key);
      if (outcome.type === "cancel") setDialog(null);
      else if (outcome.type === "focus") setDialog(outcome.state);
      else if (outcome.type === "confirm") {
        setDialog(null);
        perform(outcome.action);
      }
      return;
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
        dialogOpen: dialog !== null || bulk !== null,
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
      const tabs = TABS_BY_PANEL[detailPanel];
      setActiveTabs((prev) => {
        const idx = tabs.findIndex((t) => t.id === prev[detailPanel]);
        const next = tabs[nextTabIndex(idx, input === "]" ? 1 : -1, tabs.length)]?.id ?? "config";
        return { ...prev, [detailPanel]: next };
      });
      dispatch({ type: "resetDetailScroll" });
      return;
    }

    // Space folds/unfolds every Config section; PgUp/PgDn scroll the detail.
    // Both are inert while filtering (the filter branch above returns first),
    // where Space types a space and PgUp/PgDn have no text to append.
    // --- `T`: reload the Omarchy theme (P7-T4). ---
    if (input === "T") {
      void reloadTheme(true);
      return;
    }

    // --- `x`: bulk commands, the focused panel's first (P5-T6). ---
    if (input === "x") {
      if (busyRef.current) {
        setNotice({ tone: "error", text: "Another action is still running." });
        return;
      }
      setBulk(openBulk(orderedCommands(detailPanel, commandsFor(viewScope))));
      return;
    }

    // --- Quadlets (P6): `R` reloads systemd; `c` jumps to the container. ---
    if (input === "R" && focusId === "quadlets") {
      if (busyRef.current) return;
      busyRef.current = true;
      setNotice({ tone: "busy", text: "reloading systemd (daemon-reload)…" });
      void systemd
        .reload()
        .then(() => setNotice({ tone: "ok", text: "systemd reloaded: quadlet units regenerated" }))
        .catch((e: unknown) => {
          setNotice(undefined);
          setDialog(openMessage("Could not reload systemd", [e instanceof Error ? e.message : String(e)]));
        })
        .finally(() => {
          busyRef.current = false;
          setRefreshKey((k) => k + 1);
        });
      return;
    }
    if (input === "c" && focusId === "quadlets") {
      const q = data.quadlets.find((x) => x.id === selectedItemId);
      if (!q) return;
      const known = resource?.panel === "quadlets" && resource.id === q.id ? resource.file : null;
      void (known !== null ? Promise.resolve(known) : engine.quadletFile(socketPath, q.id))
        .then((file) => {
          const target = quadletJumpTarget(q, file, dataRef.current);
          if (target.kind === "none") {
            setNotice({ tone: "error", text: target.message });
            return;
          }
          if (state.detailFullscreen || state.zoom) dispatch({ type: "escape" });
          dispatch({ type: "activate", id: "containers" });
          dispatch({ type: "select", id: "containers", itemId: target.id });
          setNotice({ tone: "ok", text: target.message });
        })
        .catch((e: unknown) => setNotice({ tone: "error", text: e instanceof Error ? e.message : String(e) }));
      return;
    }

    // --- Cross-link (P4-T7): `c` on a pod jumps to its containers. ---
    if (input === "c" && focusId === "pods") {
      const target = podJumpTarget(data, selectedItemId);
      if (target.kind === "none") {
        setNotice({ tone: "error", text: target.message });
        return;
      }
      if (state.detailFullscreen || state.zoom) dispatch({ type: "escape" });
      dispatch({ type: "activate", id: "containers" });
      dispatch({ type: "select", id: "containers", itemId: target.id });
      setNotice({ tone: "ok", text: target.message });
      return;
    }

    // --- Item actions (P4-T5): s start, S stop, r restart, K kill, d remove.
    const verb: ActionVerb | undefined = (
      { s: "start", S: "stop", r: "restart", K: "kill", d: "remove" } as Record<string, ActionVerb>
    )[input];
    if (verb) {
      if (busyRef.current) {
        setNotice({ tone: "error", text: "Another action is still running." });
        return;
      }
      const name = focusModel?.items[focusModel.selected]?.cells["name"] ?? "";
      const request = actionFor(focusId, selectedItemId, verb, data, name);
      if (request.kind === "refuse") setNotice({ tone: "error", text: request.message });
      else if (request.kind === "run") perform(request.action);
      else setDialog(openConfirm(request.action, request.content));
      return;
    }

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
      if (id && !emptyNotice(id)) dispatch({ type: "activate", id });
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
    return <HelpOverlay size={{ cols: terminalCols, rows: terminalRows }} theme={theme} />;
  }

  return (
    <Screen
      model={shownModel}
      theme={theme}
      visible={shown}
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
      dialog={dialog}
      bulk={bulk}
    />
  );
};
