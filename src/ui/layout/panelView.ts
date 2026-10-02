import { COLLAPSED_PANEL_H, MIN_PANEL_H, MIN_PANEL_H_WITH_HEADER } from "./constants";

/**
 * How a panel of a given height must be drawn (LAYOUT_SPEC §6).
 *
 * This is the single source of truth for the short-panel rule, and it lives in
 * the pure layer so components never have to decide it themselves:
 *
 *   h >= 6  bordered, column header shown,  dataRows = h - 3
 *   h 4-5   bordered, column header DROPPED, dataRows = h - 2
 *   h < 4   collapsed to a borderless 1-row title strip, dataRows = 0
 *
 * A bordered box needs 2 rows for its own border; a 2- or 3-row box would have
 * its border overdraw its content (verified: Ink does not clip — see
 * docs/DECISIONS.md), which is why heights below 4 must never be bordered.
 */
export interface PanelMetrics {
  /** A borderless 1-row title strip. */
  collapsed: boolean;
  /** Draw box-drawing characters around the content. */
  bordered: boolean;
  /** Render the column-header row (costs 1 inner row). */
  showHeader: boolean;
  /** Rows available for item rows. */
  dataRows: number;
  /** Rows available for item rows *including* the column header. */
  innerRows: number;
}

export function panelMetrics(height: number): PanelMetrics {
  const h = Math.max(0, Math.floor(height));

  if (h < MIN_PANEL_H) {
    return {
      collapsed: true,
      bordered: false,
      showHeader: false,
      dataRows: 0,
      innerRows: 0,
    };
  }

  const showHeader = h >= MIN_PANEL_H_WITH_HEADER;
  const innerRows = h - 2;
  return {
    collapsed: false,
    bordered: true,
    showHeader,
    dataRows: innerRows - (showHeader ? 1 : 0),
    innerRows,
  };
}

/** Inner (usable) width of a bordered panel of the given outer width. */
export function innerWidth(outerWidth: number): number {
  return Math.max(0, Math.floor(outerWidth) - 2);
}

/** Title strip for a collapsed panel, e.g. `▸ 3 Images (2)`. */
export function collapsedTitle(
  marker: string,
  number: number,
  label: string,
  count: number,
): string {
  return `${marker}${number} ${label} (${count})`;
}

export { COLLAPSED_PANEL_H };
