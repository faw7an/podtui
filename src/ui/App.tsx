import React, { useState, useEffect, useRef, useCallback } from "react";
import { render, useInput, useStdout, Box as InkBox } from "ink";
import { Panel } from "./panels/Panel.tsx";
import { Box, Text } from "./components/Box.tsx";
import { createPodmanEngine } from "../engine/podman.ts";
import type { ContainerListItem, PodListItem, ImageListItem, VolumeListItem, NetworkListItem } from "../api/types.ts";

const SOCKET_PATH = "/tmp/podtui-dev/podman.sock";

const PANELS = [
  { id: "pods", title: "Pods", number: 1 },
  { id: "containers", title: "Containers", number: 2 },
  { id: "images", title: "Images", number: 3 },
  { id: "volumes", title: "Volumes", number: 4 },
  { id: "networks", title: "Networks", number: 5 },
  { id: "quadlets", title: "Quadlets", number: 6 },
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

  // Calculate bento grid layout - fill entire viewport
  const gridCols = Math.min(visiblePanels.length, Math.max(2, Math.floor(terminalSize.columns / 35)));
  const panelWidth = Math.floor(terminalSize.columns / gridCols) - 1;
  const availableHeight = terminalSize.rows - 6; // header(2) + tabBar(1) + footer(2) + margins
  const gridRows = Math.ceil(visiblePanels.length / gridCols);
  const panelHeight = Math.max(6, Math.floor(availableHeight / gridRows) - 1);

  return (
    <InkBox flexDirection="column" height="100%" width="100%" flexGrow={1}>
      {/* Header bar */}
      <Box height={2} borderStyle="single" borderColor="border" flexDirection="row" paddingX={1}>
        <Box flexDirection="row">
          <Text color="ok" bold>podtui</Text>
          <Text color="dim">  Podman TUI</Text>
        </Box>
        <Box flexGrow={1} />
        <Text color="dim">{lastRefresh.toLocaleTimeString()}</Text>
      </Box>

      {/* Tab bar - horizontal, clickable */}
      <Box height={2} flexDirection="row" paddingX={1} paddingY={0}>
        {PANELS.map((panel, _idx) => {
          const isVisible = panelStatesRef.current[panel.id].visible;
          const isFocused = focusedPanelRef.current === panel.id;
          return (
            <Box 
              key={panel.id} 
              flexDirection="row" 
              marginRight={1} 
              paddingX={1} 
              paddingY={0}
              borderStyle={isFocused ? "double" : "single"} 
              borderColor={isFocused ? "accent" : (isVisible ? "border" : "dim")}
              backgroundColor={isFocused ? "selectionBg" : "transparent"}>
              <Text color={isFocused ? "selectionFg" : (isVisible ? "foreground" : "dim")}>
                {panel.number}:{panel.title}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Main grid area - fills remaining viewport */}
      <Box flexGrow={1} flexDirection="row">
        {/* Left: Panel grid */}
        <Box width={Math.floor(terminalSize.columns * 0.55)} flexDirection="row" flexWrap="wrap" flexGrow={1} paddingX={1} paddingY={1} gap={1}>
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

        {/* Right: Detail pane */}
        <Box flexGrow={1} borderStyle="round" borderColor="border" paddingX={1} paddingY={1} paddingTop={1}>
          <Box flexDirection="row" marginBottom={1} borderStyle="single" borderColor="border" paddingX={1} paddingBottom={1}>
            <Text color="accent" bold>Detail</Text>
            <Box flexGrow={1} />
            <Text color="dim">[{focusedPanelRef.current}]</Text>
          </Box>
          {selectedDetail ? (
            <Box flexDirection="column" gap={1}>
              <Box flexDirection="row" marginBottom={1}>
                <Text color="accent" bold>{selectedDetail.label}</Text>
                <Box flexGrow={1} />
                <Text color="dim">[{selectedDetail.type}]</Text>
              </Box>
              <Text color="foreground">Status: {String(selectedDetail.data)}</Text>
              <Text color="dim">Press Enter for full inspect...</Text>
            </Box>
          ) : focusedState.items.length === 0 ? (
            <Text color="dim">No items in this panel</Text>
          ) : (
            <Text color="foreground">
              Selected: {focusedState.items[focusedState.selectedIndex]?.label || "none"}
            </Text>
          )}
        </Box>
      </Box>

      {/* Footer */}
      <Box height={2} borderStyle="single" borderColor="border" flexDirection="row" paddingX={1} paddingY={0}>
        <Text color="helpKey">1-6</Text>
        <Text color="helpDesc"> toggle</Text>
        <Box marginLeft={2}><Text color="helpKey">Tab</Text></Box>
        <Text color="helpDesc"> focus</Text>
        <Box marginLeft={2}><Text color="helpKey">↑↓/jk</Text></Box>
        <Text color="helpDesc"> nav</Text>
        <Box marginLeft={2}><Text color="helpKey">Enter</Text></Box>
        <Text color="helpDesc"> inspect</Text>
        <Box marginLeft={2}><Text color="helpKey">q</Text></Box>
        <Text color="helpDesc"> quit</Text>
        <Box flexGrow={1} />
        <Text color="dim">{lastRefresh.toLocaleTimeString()}</Text>
      </Box>

      {/* Status bar */}
      {error && (
        <Box height={2} borderStyle="single" borderColor="error" backgroundColor="error" paddingX={1} marginTop={0}>
          <Text color="foreground">{error}</Text>
        </Box>
      )}
    </InkBox>
  );
};

render(<App />);