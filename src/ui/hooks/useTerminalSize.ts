import { useWindowSize } from "ink";

export interface TerminalSize {
  columns: number;
  rows: number;
}

/** Last-resort default, matching Ink's own fallback. */
export const FALLBACK_SIZE: TerminalSize = { columns: 80, rows: 24 };

/**
 * Current terminal size, re-rendering on resize.
 *
 * Ink 7.1.1 exports `useWindowSize()`, which reads the stream handed to
 * `render()` and subscribes to its `resize` event (verified,
 * docs/DECISIONS.md). Tests drive the real path by passing a fake stdout with
 * `columns`/`rows` and emitting `resize` — `ink-testing-library` cannot do this
 * because it hardcodes `columns = 100` and has no `rows`.
 *
 * A React context for injecting the size was tried and removed: reading it
 * during an update inside this reconciler threw "Invalid hook call", so size is
 * injected through `Screen`'s `size` prop instead.
 */
export function useTerminalSize(): TerminalSize {
  const { columns, rows } = useWindowSize();
  return {
    columns: columns > 0 ? columns : FALLBACK_SIZE.columns,
    rows: rows > 0 ? rows : FALLBACK_SIZE.rows,
  };
}
