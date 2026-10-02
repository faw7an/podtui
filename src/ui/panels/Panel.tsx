import { useInput } from "ink";
import { Box, Text } from "../components/Box.tsx";

interface PanelProps {
  title: string;
  number: number;
  isFocused: boolean;
  isVisible: boolean;
  items: { id: string; label: string; status: string }[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  _onToggle: () => void;
  panelWidth: number;
}

const renderHeader = (panelWidth: number) => {
  const nameW = Math.max(10, Math.floor(panelWidth * 0.6));
  const statusW = Math.max(8, panelWidth - nameW - 2);
  return (
    <Box flexDirection="row" marginBottom={1} paddingX={1} paddingY={0}>
      <Box width={nameW}>
        <Text color="green" bold>NAME</Text>
      </Box>
      <Box width={statusW} flexDirection="row" alignItems="flex-end">
        <Text color="green" bold>STATUS</Text>
      </Box>
    </Box>
  );
};

const renderRow = (item: { id: string; label: string; status: string }, index: number, selected: boolean, panelWidth: number) => {
  const nameW = Math.max(10, Math.floor(panelWidth * 0.6));
  const statusW = Math.max(8, panelWidth - nameW - 2);
  const bgColor = selected ? "selectionBg" : undefined;
  const fgColor = selected ? "selectionFg" : "foreground";
  const prefix = selected ? "> " : "  ";
  
  return (
    <Box key={item.id} flexDirection="row" backgroundColor={bgColor} paddingX={1} paddingY={0}>
      <Box width={nameW} flexShrink={0}>
        <Text color={fgColor} wrap="truncate-end">{prefix}{item.label}</Text>
      </Box>
      <Box width={statusW} flexDirection="row" alignItems="flex-end" flexShrink={0}>
        <Text color={fgColor}>{item.status}</Text>
      </Box>
    </Box>
  );
};

export const Panel = ({
  title,
  number,
  isFocused,
  isVisible,
  items,
  selectedIndex,
  onSelect,
  _onToggle,
  panelWidth,
}: PanelProps) => {
  if (!isVisible) return null;

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      onSelect(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow || input === "j") {
      onSelect(Math.min(items.length - 1, selectedIndex + 1));
    }
  });

  return (
    <Box
      borderStyle="round"
      borderColor={isFocused ? "green" : "dim"}
      width="100%"
      height="100%"
      paddingX={1}
      paddingY={1}
    >
      <Box flexDirection="row" marginBottom={1} paddingX={1}>
        <Text color={isFocused ? "green" : "dim"} bold>[{number}] {title}</Text>
        <Box flexGrow={1} />
        <Text color="dim">{items.length} items</Text>
      </Box>
      <Box width="100%">
        {items.length > 0 ? (
          <>
            {renderHeader(panelWidth)}
            {items.map((item, index) => 
              renderRow(item, index, index === selectedIndex, panelWidth)
            )}
          </>
        ) : (
          <Box paddingY={1}>
            <Text color="dim">No items</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};