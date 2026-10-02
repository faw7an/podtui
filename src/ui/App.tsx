import React, { useState, useEffect, useRef } from "react";
import { render, useInput, useStdout, Box as InkBox } from "ink";
import { Panel } from "./panels/Panel.tsx";
import { Box, Text } from "./components/Box.tsx";
import { createPodmanEngine } from "../engine/podman.ts";
import type { ContainerListItem } from "../api/types.ts";

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

export const App = () => {
  const { stdout } = useStdout();
  const [terminalSize, setTerminalSize] = useState({ columns: 80, rows: 24 });
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);
  
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

  useEffect(() => {
    const fetchContainers = async () => {
      try {
        const list = await engine.listContainers(SOCKET_PATH, true);
        const items = list.map((c: ContainerListItem) => ({
          id: c.Id,
          label: c.Names?.[0]?.replace(/^\//, "") || c.Id.slice(0, 12),
          status: c.State || "unknown",
        }));
        panelStatesRef.current.containers.items = items;
        setLastRefresh(new Date());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch containers");
      }
    };
    fetchContainers();
    const interval = setInterval(fetchContainers, 5000);
    return () => clearInterval(interval);
  }, []);

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
    }
    if (key.downArrow || input === "j") {
      const state = panelStatesRef.current[focusedPanelRef.current];
      state.items = panelStatesRef.current[focusedPanelRef.current].items;
      state.selectedIndex = Math.min(state.items.length - 1, state.selectedIndex + 1);
    }
  });

  const minWidth = 60;
  const minHeight = 15;
  if (terminalSize.columns < minWidth || terminalSize.rows < minHeight) {
    return (
      <InkBox flexDirection="column" padding={2}>
        <Text color="error">Terminal too small</Text>
        <Text color="dim">Minimum: {minWidth}x{minHeight}, Current: {terminalSize.columns}x{terminalSize.rows}</Text>
      </InkBox>
    );
  }

  const visiblePanels = PANELS.filter(p => panelStatesRef.current[p.id].visible);
  const focusedState = panelStatesRef.current[focusedPanelRef.current];

  // Calculate grid layout based on terminal size
  const panelAreaWidth = terminalSize.columns - 2; // account for borders
  const panelAreaHeight = terminalSize.rows - 8; // header(3) + footer(3) + tabBar(1) + margins
  
  // Calculate optimal panel dimensions for bento grid
  const visibleCount = visiblePanels.length;
  const maxCols = Math.min(visibleCount, Math.max(1, Math.floor(panelAreaWidth / 30)));
  const panelWidth = Math.floor(panelAreaWidth / maxCols) - 2;
  const panelHeight = Math.max(8, Math.floor(panelAreaHeight / Math.ceil(visibleCount / maxCols)) - 2);

  return (
    <InkBox flexDirection="column" height="100%" width="100%">
      {/* Header */}
      <Box borderStyle="round" borderColor="border" paddingX={1} marginBottom={1} flexDirection="row">
        <Text color="ok">podtui</Text>
        <Text color="dim">  Podman TUI</Text>
        <Box marginLeft={2}>
          <Text color="dim">{lastRefresh.toLocaleTimeString()}</Text>
        </Box>
      </Box>

      {/* Tab Bar - horizontal 1-6 tabs */}
      <Box flexDirection="row" marginBottom={1} paddingX={1}>
        {PANELS.map(panel => {
          const isVisible = panelStatesRef.current[panel.id].visible;
          const isFocused = focusedPanelRef.current === panel.id;
          return (
            <Box key={panel.id} flexDirection="row" marginRight={1} paddingX={1} 
                 borderStyle={isFocused ? "round" : "single"} 
                 borderColor={isFocused ? "accent" : (isVisible ? "border" : "dim")}
                 backgroundColor={isFocused ? "selectionBg" : (isVisible ? "transparent" : "dim")}>
              <Text color={isFocused ? "selectionFg" : (isVisible ? "foreground" : "dim")}>
                [{panel.number}] {panel.title}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Main content - Bento Grid */}
      <Box flexDirection="row" flexGrow={1}>
        {/* Grid of panels */}
        <Box width={Math.max(30, Math.floor(terminalSize.columns * 0.6))} flexDirection="column" flexGrow={1} flexWrap="wrap" marginRight={1}>
          {visiblePanels.map((panel, _idx) => (
            <Box key={panel.id} width={panelWidth} height={panelHeight} marginRight={1} marginBottom={1}>
              <Panel
                title={panel.title}
                number={panel.number}
                isFocused={focusedPanelRef.current === panel.id}
                isVisible={true}
                items={panelStatesRef.current[panel.id].items}
                selectedIndex={panelStatesRef.current[panel.id].selectedIndex}
                onSelect={(index) => { panelStatesRef.current[panel.id].selectedIndex = index; }}
                _onToggle={() => { panelStatesRef.current[panel.id].visible = !panelStatesRef.current[panel.id].visible; }}
              />
            </Box>
          ))}
        </Box>

        {/* Detail pane */}
        <Box flexGrow={1} borderStyle="round" borderColor="border" paddingX={1} paddingY={1} width={Math.max(25, terminalSize.columns - Math.floor(terminalSize.columns * 0.6))}>
          <Box flexDirection="row" marginBottom={1} borderStyle="single" borderColor="border" paddingX={1}>
            <Text color="accent">Detail</Text>
            <Box marginLeft={2}>
              <Text color="dim">[{focusedPanelRef.current}]</Text>
            </Box>
          </Box>
          {focusedState.items.length === 0 ? (
            <Text color="dim">No items</Text>
          ) : (
            <Text color="foreground">
              Selected: {focusedState.items[focusedState.selectedIndex]?.label || "none"}
            </Text>
          )}
        </Box>
      </Box>

      {/* Footer */}
      <Box borderStyle="round" borderColor="border" paddingX={1} marginTop={1}>
        <Box flexDirection="row">
          <Text color="helpKey">1-6</Text>
          <Text color="helpDesc"> toggle panels</Text>
          <Box marginLeft={2}>
            <Text color="helpKey">Tab</Text>
          </Box>
          <Box marginLeft={2}>
            <Text color="helpDesc">focus</Text>
          </Box>
          <Box marginLeft={2}>
            <Text color="helpKey">↑↓/jk</Text>
          </Box>
          <Box marginLeft={2}>
            <Text color="helpDesc">navigate</Text>
          </Box>
          <Box marginLeft={2}>
            <Text color="helpKey">q</Text>
          </Box>
          <Box marginLeft={2}>
            <Text color="helpDesc">quit</Text>
          </Box>
        </Box>
      </Box>

      {/* Status bar */}
      {error && (
        <Box borderStyle="round" borderColor="error" paddingX={1} marginTop={1} backgroundColor="error">
          <Text color="foreground">{error}</Text>
        </Box>
      )}
    </InkBox>
  );
};

render(<App />);