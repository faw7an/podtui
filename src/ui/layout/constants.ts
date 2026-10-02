/**
 * Layout constants for the computed frame (LAYOUT_SPEC.md).
 *
 * These are deliberately collected in one place: the breakpoints and minimum
 * sizes are the knobs that decide when the UI degrades, and they are asserted
 * by the property tests in test/layout.test.ts.
 */

export const BREAKPOINTS = {
  /** cols >= 150: sidebar + main split */
  XL: 150,
  /** cols >= 120: sidebar + main split, tighter sidebar */
  L: 120,
  /** cols >= 100: sidebar becomes a horizontal strip */
  M: 100,
  /** cols >= 40: single column */
  S: 40,
} as const;

/** Below either of these we cannot draw anything useful. */
export const MIN_COLS = 40;
export const MIN_ROWS = 10;

/** Sidebar width as a fraction of the frame at each breakpoint. */
export const SIDEBAR_FRACTION = {
  XL: 0.3,
  L: 0.26,
  M: 0.22,
} as const;

export const SIDEBAR_MIN_W = 18;
export const SIDEBAR_MAX_W = 34;

/** Height of the fixed rows, in terminal cells. */
export const HEADER_H = 1;
export const TABS_H = 1;
export const FOOTER_H = 1;
export const FIXED_TOP_H = HEADER_H + TABS_H;
export const FIXED_CHROME_H = HEADER_H + TABS_H + FOOTER_H;

/**
 * A panel is border (2) + column header (1) + >=1 data row, i.e. 4. Anything
 * less and the border overdraws its own content — see docs/DECISIONS.md.
 */
export const PANEL_CHROME_H = 3;
export const MIN_PANEL_H = PANEL_CHROME_H + 1;
export const MIN_PANEL_W = 12;

/** Chrome inside a detail pane: border + optional header. */
export const DETAIL_CHROME_H = 2;
export const MIN_DETAIL_W = 20;

/** Weight used when distributing surplus height; focused panel gets more. */
export const FOCUS_HEIGHT_WEIGHT = 1.5;
export const NORMAL_HEIGHT_WEIGHT = 1;

/** Sidebar row geometry. */
export const SIDEBAR_ROW_H = 1;
export const SIDEBAR_PADDING_X = 1;

export const SCROLL_HINT_MORE = "more";
export const SCROLL_HINT_MORE_DOWN = "more ↓";
export const SCROLL_HINT_MORE_UP = "↑ more";
