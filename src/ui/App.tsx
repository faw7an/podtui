import React, { useState, useEffect, useRef, useCallback } from "react";
import { render, useInput, useStdout, Box as InkBox } from "ink";
import { Panel } from "./panels/Panel.tsx";
import { Box, Text } from "./components/Box.tsx";
import { createPodmanEngine } from "../engine/podman.ts";
import type { ContainerListItem, PodListItem, ImageListItem, VolumeListItem, NetworkListItem } from "../api/types.ts";

const SOCKET_PATH = "/tmp/podtui-dev/podman.sock";

const PANELS = [
  { id: "pods", title: "Pods", number: 1, color: "magenta" },
  { id: "containers", title: "Containers", number: 2, color: "green" },
  { id: "images", title: "Images", number: 3, color: "blue" },
  { id: "volumes", title: "Volumes", number: 4, color: "yellow" },
  { id: "networks", title: "Networks", number: 5, color: "cyan" },
  { id: "quadlets", title: "Quadlets", number: 6, color: "magenta" },
] as const;

type PanelId = typeof PANELS[number]["id"];

interface PanelState {
  visible: boolean;
  selectedIndex: number;
  items: { id: string; label: string; status: string }[];
}

interface ItemDetail {
  id: string;
  label: string;
  type: PanelId;
  data: unknown;
}

export const App = () => {
  const { stdout } = useStdout();
  const [terminalSize, setTerminalSize] = useState({ columns: 80, rows: 24 });
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<ItemDetail | null>(null);
  
  const panelStatesRef = useRef<Record<PanelId, PanelState>>({
    pods: { visible: true, selectedIndex: 0, items: [] },
    containers: { visible: true, selectedIndex: 0, items: [] },
    images: { visible: true, selectedIndex: 0, items: [] },
    volumes: { visible: true, selectedIndex: 0, items: [] },
    networks: { visible: true, selectedIndex: 0, items: [] },
    quadlets: { visible: true, selectedIndex: 0, items: [] },
  });

  const focusedPanelRef = useRef<PanelId>("containers");
  const engine = createPodmanEngine();

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      setTerminalSize({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
    };
    stdout.on("resize", handleResize);
    handleResize();
    return () => {
      stdout.off("resize", handleResize);
    };
  }, []);

  // Fetch data for all panels
  const fetchAllData = useCallback(async () => {
    try {
      // Containers
      const containers = await engine.listContainers(SOCKET_PATH, true);
      panelStatesRef.current.containers.items = containers.map((c: ContainerListItem) => ({
        id: c.Id,
        label: c.Names?.[0]?.replace(/^\//, "") || c.Id.slice(0, 12),
        status: c.State || "unknown",
      }));

      // Pods
      const pods = await engine.listPods(SOCKET_PATH);
      panelStatesRef.current.pods.items = pods.map((p: PodListItem) => ({
        id: p.Id,
        label: p.Name || p.Id.slice(0, 12),
        status: p.Status || "unknown",
      }));

      // Images
      const images = await engine.listImages(SOCKET_PATH, true);
      panelStatesRef.current.images.items = images.map((i: ImageListItem) => ({
        id: i.Id,
        label: i.RepoTags?.[0] || i.Id.slice(0, 12),
        status: "ready",
      }));

      // Volumes
      const volumes = await engine.listVolumes(SOCKET_PATH);
      panelStatesRef.current.volumes.items = volumes.map((v: VolumeListItem) => ({
        id: v.Name,
        label: v.Name,
        status: v.Mountpoint ? "mounted" : "available",
      }));

      // Networks
      const networks = await engine.listNetworks(SOCKET_PATH);
      panelStatesRef.current.networks.items = networks.map((n: NetworkListItem) => ({
        id: n.id || n.name,
        label: n.name,
        status: n.driver || "bridge",
      }));

      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch data");
    }
  }, []);

  useEffect(() => {
    fetchAllData();
    const interval = setInterval(fetchAllData, 5000);
    return () => clearInterval(interval);
  }, [fetchAllData]);

  // Input handling
  useInput((input, key) => {
    if (input === "q" || key.escape) {
      process.exit(0);
    }
    if (input >= "1" && input <= "6") {
      const panel = PANELS[parseInt(input) - 1];
      if (panel) {
        panelStatesRef.current[panel.id].visible = !panelStatesRef.current[panel.id].visible;
        const visibleCount = PANELS.filter(p => panelStatesRef.current[p.id].visible).length;
        if (visibleCount === 0) {
          panelStatesRef.current[panel.id].visible = true;
        }
      }
    }
    if (key.tab) {
      const visiblePanels = PANELS.filter(p => panelStatesRef.current[p.id].visible);
      if (visiblePanels.length > 0) {
        const currentIndex = visiblePanels.findIndex(p => p.id === focusedPanelRef.current);
        const nextIndex = (currentIndex + 1) % visiblePanels.length;
        const nextPanel = visiblePanels[nextIndex];
        if (nextPanel) {
          focusedPanelRef.current = nextPanel.id;
        }
      }
    }
    if (key.upArrow || input === "k") {
      const state = panelStatesRef.current[focusedPanelRef.current];
      state.selectedIndex = Math.max(0, state.selectedIndex - 1);
      updateDetail();
    }
    if (key.downArrow || input === "j") {
      const state = panelStatesRef.current[focusedPanelRef.current];
      state.items = panelStatesRef.current[focusedPanelRef.current].items;
      state.selectedIndex = Math.min(state.items.length - 1, state.selectedIndex + 1);
      updateDetail();
    }
  });

  const updateDetail = () => {
    const state = panelStatesRef.current[focusedPanelRef.current];
    const item = state.items[state.selectedIndex];
    if (item) {
      setSelectedDetail({
        id: item.id,
        label: item.label,
        type: focusedPanelRef.current,
        data: { status: item.status },
      });
    }
  };

  const visiblePanels = PANELS.filter(p => panelStatesRef.current[p.id].visible);
  const focusedState = panelStatesRef.current[focusedPanelRef.current];

  // Layout constants - fixed heights for each section
  const FIXED_H = 8; // header(2) + tabBar(2) + footer(2) + margins(2)
  
  // Calculate bento grid layout - exact viewport fit
  const visibleCount = visiblePanels.length;
  const gridCols = Math.min(visibleCount, Math.max(2, Math.floor(terminalSize.columns / 38)));
  const panelWidth = Math.max(28, Math.floor(terminalSize.columns / gridCols) - 1);
  const availableHeight = terminalSize.rows - FIXED_H;
  const gridRows = Math.ceil(visibleCount / gridCols);
  const panelHeight = Math.max(6, Math.floor((availableHeight - gridRows) / gridRows));

  // Status colors (htop-style)
  const getStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s === "running") return "green";
    if (s === "exited" || s === "dead") return "red";
    if (s === "paused") return "yellow";
    if (s === "created" || s === "restarting") return "yellow";
    if (s === "mounted" || s === "ready") return "green";
    if (s === "available") return "cyan";
    return "dim";
  };

  const truncate = (str: string, max: number) => 
    str.length > max ? str.slice(0, max - 1) + "…" : str.padEnd(max);

  return (
    <InkBox flexDirection="column" height={terminalSize.rows} width="100%">
      {/* Header bar - fixed 2 rows */}
      <Box height={2} borderStyle="single" borderColor="cyan" flexDirection="row" paddingX={1} paddingY={0}>
        <Box flexDirection="row" paddingRight={2}>
          <Text color="green" bold>▲ podtui</Text>
          <Text color="dim">  Podman TUI</Text>
        </Box>
        <Box flexGrow={1} />
        <Box flexDirection="row" paddingLeft={2}>
          <Text color="cyan">[</Text>
          <Text color="yellow">{lastRefresh.toLocaleTimeString()}</Text>
          <Text color="cyan">]</Text>
        </Box>
      </Box>

      {/* Tab bar - fixed 2 rows */}
      <Box height={2} flexDirection="row" paddingX={1} paddingY={0}>
        {PANELS.map((panel) => {
          const isVisible = panelStatesRef.current[panel.id].visible;
          const isFocused = focusedPanelRef.current === panel.id;
          const tabColor = isFocused ? "black" : (isVisible ? "foreground" : "dim");
          const bgColor = isFocused ? "selectionBg" : "transparent";
          const borderC = isFocused ? "green" : (isVisible ? panel.color : "dim");
          const borderS = isFocused ? "double" : "single";
          
          return (
            <Box 
              key={panel.id} 
              marginRight={1} 
              paddingX={2} 
              paddingY={0}
              borderStyle={borderS} 
              borderColor={borderC}
              backgroundColor={bgColor}>
              <Text color={tabColor} bold={isFocused}>
                {panel.number} {panel.title}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Main area - fills remaining space exactly */}
      <Box flexGrow={1} flexDirection="row">
        {/* Left: Panel grid - 60% width */}
        <Box width={Math.floor(terminalSize.columns * 0.58)} flexDirection="row" flexWrap="wrap" flexGrow={1} paddingX={1} paddingY={1} gap={1}>
          {visiblePanels.map((panel, _idx) => (
            <Box key={panel.id} width={panelWidth} height={panelHeight} marginRight={1} marginBottom={1} flexShrink={0}>
              <Panel
                title={panel.title}
                number={panel.number}
                isFocused={focusedPanelRef.current === panel.id}
                isVisible={true}
                items={panelStatesRef.current[panel.id].items}
                selectedIndex={panelStatesRef.current[panel.id].selectedIndex}
                onSelect={(index) => { 
                  panelStatesRef.current[panel.id].selectedIndex = index; 
                  updateDetail();
                }}
                _onToggle={() => { panelStatesRef.current[panel.id].visible = !panelStatesRef.current[panel.id].visible; }}
              />
            </Box>
          ))}
        </Box>

        {/* Right: Detail pane - 40% width */}
        <Box flexGrow={1} borderStyle="round" borderColor="cyan" paddingX={1} paddingY={1} paddingTop={1} minWidth={30}>
          <Box height={2} flexDirection="row" borderStyle="single" borderColor="cyan" paddingX={1} paddingBottom={1}>
            <Text color="green" bold>▸ DETAIL</Text>
            <Box flexGrow={1} />
            <Text color="dim">[{focusedPanelRef.current}]</Text>
          </Box>
          {selectedDetail ? (
            <Box flexDirection="column" gap={1}>
              <Box flexDirection="row" marginBottom={1}>
                <Text color="green" bold>{truncate(selectedDetail.label, 30)}</Text>
                <Box flexGrow={1} />
                <Text color="dim">[{selectedDetail.type}]</Text>
              </Box>
              <Text color="foreground">Status: {String(selectedDetail.data)}</Text>
              <Text color="dim">Press Enter for full inspect...</Text>
            </Box>
          ) : focusedState.items.length === 0 ? (
            <Box flexDirection="column" gap={1}>
              <Text color="dim">No items in this panel</Text>
              <Text color="dim">Press 1-6 to show panels</Text>
            </Box>
          ) : (
            <Box flexDirection="column" gap={1}>
              <Text color="foreground">
                {truncate(focusedState.items[focusedState.selectedIndex]?.label || "none", 35)}
              </Text>
              <Text color={getStatusColor(focusedState.items[focusedState.selectedIndex]?.status || "")}>
                ● {focusedState.items[focusedState.selectedIndex]?.status || "unknown"}
              </Text>
              <Text color="dim">Press Enter for full inspect...</Text>
            </Box>
          )}
        </Box>
      </Box>

      {/* Footer - fixed 2 rows */}
      <Box height={2} borderStyle="single" borderColor="cyan" flexDirection="row" paddingX={1} paddingY={0}>
        <Box flexDirection="row" gap={2}>
          <Text color="green" bold>1-6</Text>
          <Text color="dim">toggle panels</Text>
          <Text color="green" bold>Tab</Text>
          <Text color="dim">focus panel</Text>
          <Text color="green" bold>↑↓ j/k</Text>
          <Text color="dim">navigate</Text>
          <Text color="green" bold>Enter</Text>
          <Text color="dim">inspect</Text>
          <Text color="red" bold>q</Text>
          <Text color="dim">quit</Text>
        </Box>
        <Box flexGrow={1} />
        <Text color="cyan">[</Text>
        <Text color="yellow">{lastRefresh.toLocaleTimeString()}</Text>
        <Text color="cyan">]</Text>
      </Box>

      {/* Error bar - fixed 2 rows */}
      {error && (
        <Box height={2} borderStyle="single" borderColor="red" backgroundColor="red" paddingX={1} paddingY={0}>
          <Text color="white" bold>⚠ {error}</Text>
        </Box>
      )}
    </InkBox>
  );
};

render(<App />);