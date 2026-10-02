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
}

export const Panel = ({
  title,
  number,
  isFocused,
  isVisible,
  items,
  selectedIndex,
  onSelect,
  _onToggle,
}: PanelProps) => {
  if (!isVisible) return null;

  const borderColor = isFocused ? "accent" : "border";
  const titleColor = isFocused ? "panelTitleFocused" : "panelTitle";

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
      borderColor={borderColor}
      width="100%"
      height="100%"
      paddingX={1}
      paddingY={1}
    >
      <Box flexDirection="row" marginBottom={1}>
        <Text color={titleColor}>[{number}] {title}</Text>
      </Box>
      {items.map((item, index) => (
        <Box
          key={item.id}
          flexDirection="row"
          backgroundColor={index === selectedIndex ? "selectionBg" : undefined}
        >
          <Text color={index === selectedIndex ? "selectionFg" : "foreground"}>
            {index === selectedIndex ? "> " : "  "}
            {item.label}
            <Text color="dim"> [{item.status}]</Text>
          </Text>
        </Box>
      ))}
    </Box>
  );
};