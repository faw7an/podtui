import { useInput } from "ink";
import { Box, Text } from "../components/Box.tsx";

export interface PanelItem {
  id: string;
  label: string;
  status: string;
}

interface PanelProps {
  title: string;
  number: number;
  isFocused: boolean;
  isVisible: boolean;
  items: PanelItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  _onToggle: () => void;
  /** Usable text width inside the border+padding. */
  innerWidth: number;
  /** Max data rows to render (windowed around selection). */
  maxRows: number;
}

const STATUS_W = 10; // fits "restarting"

/**
 * Build one row as a single pre-truncated, column-aligned string:
 * `  web            ● running  `
 *
 * The status field width is FIXED (not derived from the status text) so that
 * every row's `●` lands on the same column — that is what makes the list read
 * as a table. Total length is always exactly innerWidth.
 */
export function buildRowLine(item: PanelItem, selected: boolean, innerWidth: number): string {
  const prefix = selected ? "> " : "  ";
  const marker = " ● ";
  const avail = innerWidth - prefix.length - marker.length;
  if (avail < 4) return (prefix + item.label).slice(0, innerWidth);

  const statusW = Math.min(STATUS_W, Math.max(3, avail - 1));
  const nameW = Math.max(1, avail - statusW);

  const name =
    item.label.length > nameW ? `${item.label.slice(0, Math.max(0, nameW - 1))}…` : item.label.padEnd(nameW);
  const status =
    item.status.length > statusW ? `${item.status.slice(0, Math.max(0, statusW - 1))}…` : item.status.padEnd(statusW);

  return prefix + name + marker + status;
}

/** Status color for the ● indicator (htop-style). */
export function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "running" || s === "mounted" || s === "ready") return "green";
  if (s === "exited" || s === "dead") return "red";
  if (s === "paused" || s === "created" || s === "restarting") return "yellow";
  if (s === "available" || s === "bridge") return "cyan";
  return "dim";
}

/** Window items around the selection so the list never overflows its box. */
export function windowItems<T>(items: T[], selected: number, maxRows: number): { slice: T[]; offset: number } {
  if (items.length <= maxRows) return { slice: items, offset: 0 };
  const half = Math.floor(maxRows / 2);
  const start = Math.min(Math.max(0, selected - half), items.length - maxRows);
  return { slice: items.slice(start, start + maxRows), offset: start };
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
  innerWidth,
  maxRows,
}: PanelProps) => {
  if (!isVisible) return null;

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      onSelect(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow || input === "j") {
      onSelect(Math.min(items.length - 1, selectedIndex + 1));
    }
  });

  const { slice, offset } = windowItems(items, selectedIndex, Math.max(1, maxRows));
  const w = Math.max(12, innerWidth);

  return (
    <Box
      borderStyle="round"
      borderColor={isFocused ? "green" : "dim"}
      width="100%"
      height="100%"
      flexDirection="column"
      paddingX={1}
    >
      <Box flexDirection="row">
        <Text color={isFocused ? "green" : "white"} bold wrap="truncate">
          [{number}] {title}
        </Text>
        <Box flexGrow={1} />
        <Text color="dim" wrap="truncate">
          {items.length}
        </Text>
      </Box>
      {slice.length > 0 ? (
        slice.map((item, i) => {
          const index = offset + i;
          const selected = index === selectedIndex;
          return (
            <Text
              key={item.id}
              color={selected ? "black" : undefined}
              backgroundColor={selected ? "blue" : undefined}
              bold={selected}
              wrap="truncate"
            >
              {buildRowLine(item, selected, w)}
            </Text>
          );
        })
      ) : (
        <Text color="dim" wrap="truncate">
          (empty)
        </Text>
      )}
    </Box>
  );
};
