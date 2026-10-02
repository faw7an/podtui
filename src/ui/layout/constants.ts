/**
 * Layout constants for the computed frame (LAYOUT_SPEC.md).
 *
 * The numbers here are the ones in LAYOUT_SPEC §5. They are tunable, but they
 * were changed once by accident (to 120/100/40) and that was reverted: the
 * spec is the source of truth. See docs/DECISIONS.md.
 */

/** LAYOUT_SPEC §5 responsive breakpoints. */
export const BREAKPOINTS = {
  /** cols >= 150: 2-column list grid + detail on the right */
  XL: 150,
  /** 110 <= cols < 150: single list column + detail on the right */
  L: 110,
  /** 70 <= cols < 110: list band on top, detail below */
  M: 70,
  /** cols < 70: single region (focused panel, or detail full-screen) */
  S: 40,
} as const;

/** LAYOUT_SPEC §5 "Too small": below either of these nothing is drawn. */
export const MIN_COLS = 40;
export const MIN_ROWS = 10;

/** LAYOUT_SPEC §5: list area as a fraction of `cols`, detail takes the rest. */
export const LIST_FRACTION_XL = 0.55;
export const LIST_FRACTION_L = 0.45;

/** LAYOUT_SPEC §5: list area gets ~45% of the width in mode L. */
export const LIST_MIN_W_L = 40;

/** LAYOUT_SPEC §5: in XL, fall back to L if a grid column would be < 30. */
export const GRID_COLUMNS_XL = 2;
export const MIN_PANEL_W = 30;

/** LAYOUT_SPEC §5: mode M puts ~50% of the body in the list band. */
export const LIST_BAND_FRACTION_M = 0.5;

/** LAYOUT_SPEC §7: detail keeps at least this width in XL/L. */
export const MIN_DETAIL_W = 40;

/** Smallest bordered detail box: border (2) + one content row. */
export const MIN_DETAIL_H = 3;

/**
 * LAYOUT_SPEC §3: header (with the tab bar inside it) and footer are each
 * exactly one row, so the body is `rows - 2`.
 */
export const HEADER_H = 1;
export const FOOTER_H = 1;
export const FIXED_CHROME_H = HEADER_H + FOOTER_H;
export const BODY_TOP_Y = HEADER_H;

/**
 * Panel chrome: border (2) + column header (1). A panel also needs at least
 * one data row, so the smallest bordered panel is 4 rows.
 *
 * Short-panel rule (LAYOUT_SPEC §6, see panelMetrics in panelView.ts):
 *   h >= 6 -> border + column header + data rows
 *   h 4-5  -> border, column header dropped, data rows only
 *   h < 4  -> collapsed to a borderless 1-row title strip
 */
export const PANEL_CHROME_H = 3;
export const MIN_PANEL_H = 4;
/** Collapsed panels are a single title strip with no border. */
export const COLLAPSED_PANEL_H = 1;
/** At 6 rows or more a panel can afford its column header. */
export const MIN_PANEL_H_WITH_HEADER = 6;

/** Height weights for surplus distribution (LAYOUT_SPEC §5). */
export const FOCUS_HEIGHT_WEIGHT = 1.5;
export const NORMAL_HEIGHT_WEIGHT = 1;

/** Marker prefix that carries focus/selection meaning without color. */
export const FOCUS_MARKER = "▸ ";
export const UNFOCUSED_MARKER = "  ";

/** Scroll hints live in the bottom border, so they cost no data row. */
export const SCROLL_HINT_DOWN = "↓ N more";
export const SCROLL_HINT_UP = "↑ N more";
