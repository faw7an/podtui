import React, { useState, useEffect, useRef, useCallback } from "react";
import { useInput, useStdout, Box as InkBox } from "ink";
import { Panel, statusColor, type PanelItem } from "./panels/Panel.tsx";
import { Box, Text } from "./components/Box.tsx";
import { createPodmanEngine } from "../engine/podman.ts";
import type { ContainerListItem, PodListItem, ImageListItem, VolumeListItem, NetworkListItem } from "../api/types.ts";

const SOCKET_PATH = process.env["PODTUI_SOCKET"] ?? "/tmp/podtui-dev/podman.sock";

const PANELS = [
  { id: "pods", title: "Pods", short: "Pods", number: 1, color: "magenta" },
  { id: "containers", title: "Containers", short: "Cont", number: 2, color: "green" },
  { id: "images", title: "Images", short: "Imgs", number: 3, color: "blue" },
  { id: "volumes", title: "Volumes", short: "Vols", number: 4, color: "yellow" },
  { id: "networks", title: "Networks", short: "Nets", number: 5, color: "cyan" },
  { id: "quadlets", title: "Quadlets", short: "Quads", number: 6, color: "magenta" },
] as const;

type PanelId = (typeof PANELS)[number]["id"];

interface PanelState {
  visible: boolean;
  selectedIndex: number;
  items: PanelItem[];
}

const MIN_COLS = 80;
const MIN_ROWS = 20;

/** Shorten `docker.io/library/nginx:alpine` -> `nginx:alpine`. */
export function shortenImageName(name: string): string {
  return name.replace(/^docker\.io\/library\//, "").replace(/^docker\.io\//, "");
}

export const App = () => {
  const { stdout } = useStdout();
  const [terminalSize, setTerminalSize] = useState({ columns: 80, rows: 24 });
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);
  const [, forceRender] = useState(0);

  const panelStatesRef = useRef<Record<PanelId, PanelState>>({
    pods: { visible: true, selectedIndex: 0, items: [] },
    containers: { visible: true, selectedIndex: 0, items: [] },
    images: { visible: true, selectedIndex: 0, items: [] },
    volumes: { visible: true, selectedIndex: 0, items: [] },
    networks: { visible: true, selectedIndex: 0, items: [] },
    quadlets: { visible: true, selectedIndex: 0, items: [] },
  });
  const focusedPanelRef = useRef<PanelId>("containers");
  const engineRef = useRef(createPodmanEngine());

  const rerender = useCallback(() => forceRender((n) => n + 1), []);

  useEffect(() => {
    const onResize = () => setTerminalSize({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
    stdout.on("resize", onResize);
    onResize();
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  const fetchAllData = useCallback(async () => {
    const engine = engineRef.current;
    const p = panelStatesRef.current;
    try {
      const [containers, pods, images, volumes, networks] = await Promise.all([
        engine.listContainers(SOCKET_PATH, true),
        engine.listPods(SOCKET_PATH),
        engine.listImages(SOCKET_PATH, true),
        engine.listVolumes(SOCKET_PATH),
        engine.listNetworks(SOCKET_PATH),
      ]);

      p.containers.items = containers.map((c: ContainerListItem) => ({
        id: c.Id,
        label: c.Names?.[0]?.replace(/^\//, "") || c.Id.slice(0, 12),
        status: c.State || "unknown",
      }));
      p.pods.items = pods.map((x: PodListItem) => ({
        id: x.Id,
        label: x.Name || x.Id.slice(0, 12),
        status: x.Status || "unknown",
      }));
      p.images.items = images.map((i: ImageListItem) => ({
        id: i.Id,
        label: shortenImageName(i.RepoTags?.[0] ?? "") || i.Id.slice(0, 12),
        status: formatBytes(i.Size),
      }));
      p.volumes.items = volumes.map((v: VolumeListItem) => ({
        id: v.Name,
        label: v.Name,
        status: v.Mountpoint ? "mounted" : "unused",
      }));
      p.networks.items = networks.map((n: NetworkListItem) => ({
        id: n.id || n.name,
        label: n.name,
        status: n.driver || "bridge",
      }));

      setError(null);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch data");
    }
  }, []);

  useEffect(() => {
    void fetchAllData();
    const id = setInterval(() => void fetchAllData(), 5000);
    return () => clearInterval(id);
  }, [fetchAllData]);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      process.exit(0);
    }
    if (input >= "1" && input <= "6") {
      const panel = PANELS[Number.parseInt(input, 10) - 1];
      if (panel) {
        const wouldHide = panelStatesRef.current[panel.id].visible;
        const visibleCount = PANELS.filter((p) => panelStatesRef.current[p.id].visible).length;
        if (wouldHide && visibleCount === 1) return; // never allow zero visible panels
        panelStatesRef.current[panel.id].visible = !wouldHide;
        if (!panelStatesRef.current[focusedPanelRef.current].visible) {
          focusedPanelRef.current = panel.id;
        }
        rerender();
      }
      return;
    }
    if (key.tab) {
      const visible = PANELS.filter((p) => panelStatesRef.current[p.id].visible);
      if (visible.length > 0) {
        const i = visible.findIndex((p) => p.id === focusedPanelRef.current);
        const next = visible[(i + 1) % visible.length];
        if (next) focusedPanelRef.current = next.id;
        rerender();
      }
      return;
    }
    if (key.upArrow || input === "k") {
      const s = panelStatesRef.current[focusedPanelRef.current];
      s.selectedIndex = Math.max(0, s.selectedIndex - 1);
      rerender();
      return;
    }
    if (key.downArrow || input === "j") {
      const s = panelStatesRef.current[focusedPanelRef.current];
      s.selectedIndex = Math.min(Math.max(0, s.items.length - 1), s.selectedIndex + 1);
      rerender();
    }
  });

  if (terminalSize.columns < MIN_COLS || terminalSize.rows < MIN_ROWS) {
    return (
      <InkBox flexDirection="column" width="100%" height="100%">
        <Box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
          <Text color="red" bold>
            ⚠ Terminal too small
          </Text>
          <Text color="dim">
            Need {MIN_COLS}×{MIN_ROWS}, have {terminalSize.columns}×{terminalSize.rows}
          </Text>
        </Box>
      </InkBox>
    );
  }

  const visiblePanels = PANELS.filter((p) => panelStatesRef.current[p.id].visible);
  const sidebarWidth = Math.min(38, Math.max(30, Math.floor(terminalSize.columns * 0.3)));
  const panelInnerWidth = sidebarWidth - 4; // border(2) + paddingX(1)*2
  const mainHeight = terminalSize.rows - 3; // header + tabbar + footer
  const panelBoxHeight = Math.max(3, Math.floor(mainHeight / Math.max(1, visiblePanels.length)));
  const panelMaxRows = Math.max(1, panelBoxHeight - 3); // border(2) + title(1)

  const focusedId = focusedPanelRef.current;
  const focusedState = panelStatesRef.current[focusedId];
  const focusedItem = focusedState.items[focusedState.selectedIndex];

  return (
    <InkBox flexDirection="column" width={terminalSize.columns} height={terminalSize.rows}>
      {/* Header */}
      <Box flexDirection="row" paddingX={1}>
        <Text color="green" bold>
          ▲ podtui
        </Text>
        <Text color="dim"> Podman TUI </Text>
        <Box flexGrow={1} />
        <Text color="dim">{lastRefresh.toLocaleTimeString()}</Text>
      </Box>

      {/* Tab bar */}
      <Box flexDirection="row" paddingX={1} flexWrap="nowrap">
        {PANELS.map((panel) => {
          const visible = panelStatesRef.current[panel.id].visible;
          const focused = focusedId === panel.id;
          return (
            <Box key={panel.id} flexShrink={0} marginRight={1}>
              <Text
                color={visible ? (focused ? "green" : "white") : "dim"}
                bold={focused}
                backgroundColor={focused ? "blue" : undefined}
                inverse={focused}
                wrap="truncate"
              >
                {` ${panel.number}:${panel.short} `}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Main: sidebar + detail */}
      <Box flexDirection="row" flexGrow={1}>
        <Box width={sidebarWidth} flexDirection="column" flexShrink={0}>
          {visiblePanels.map((panel) => (
            <Box key={panel.id} height={panelBoxHeight} flexDirection="column">
              <Panel
                title={panel.title}
                number={panel.number}
                isFocused={focusedId === panel.id}
                isVisible={panelStatesRef.current[panel.id].visible}
                items={panelStatesRef.current[panel.id].items}
                selectedIndex={panelStatesRef.current[panel.id].selectedIndex}
                onSelect={(index) => {
                  panelStatesRef.current[panel.id].selectedIndex = index;
                  rerender();
                }}
                _onToggle={() => {
                  panelStatesRef.current[panel.id].visible = !panelStatesRef.current[panel.id].visible;
                  rerender();
                }}
                innerWidth={panelInnerWidth}
                maxRows={panelMaxRows}
              />
            </Box>
          ))}
        </Box>

        <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="cyan" paddingX={1}>
          <Box flexDirection="row">
            <Text color="green" bold wrap="truncate">
              ▸ DETAIL
            </Text>
            <Box flexGrow={1} />
            <Text color="dim" wrap="truncate">
              {focusedId}
            </Text>
          </Box>
          {focusedItem ? (
            <Box flexDirection="column">
              <Text color="white" bold wrap="truncate">
                {focusedItem.label}
              </Text>
              <Text color={statusColor(focusedItem.status)} wrap="truncate">
                ● {focusedItem.status}
              </Text>
              <Text color="dim" wrap="truncate">
                id {focusedItem.id.slice(0, 12)}
              </Text>
              <Text color="dim" wrap="truncate">
                Enter — inspect (coming soon)
              </Text>
            </Box>
          ) : (
            <Text color="dim" wrap="truncate">
              No selection
            </Text>
          )}
        </Box>
      </Box>

      {/* Footer */}
      <Box flexDirection="row" paddingX={1}>
        <Text color="green" bold>
          1-6
        </Text>
        <Text color="dim"> panel </Text>
        <Text color="green" bold>
          Tab
        </Text>
        <Text color="dim"> focus </Text>
        <Text color="green" bold>
          ↑↓jk
        </Text>
        <Text color="dim"> move </Text>
        <Text color="red" bold>
          q
        </Text>
        <Text color="dim"> quit</Text>
        <Box flexGrow={1} />
        {error ? <Text color="red" wrap="truncate">{`! ${error}`}</Text> : null}
      </Box>
    </InkBox>
  );
};

/** SI units (10^3) to match what `podman images` prints: 64.3MB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
  const value = bytes / 1000 ** i;
  return `${i === 0 ? value.toFixed(0) : value.toFixed(1)}${units[i]}`;
}

export { PANELS };
