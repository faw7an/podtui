import type { Layout, PanelId, Rect } from "./types.ts";

/**
 * Where the `/` filter popup goes (redesigned filter UX).
 *
 * The popup is a small bordered box drawn over the frame, positioned from the
 * already-computed `Layout` — never from fresh measurements — so it obeys the
 * same inside-the-body discipline as every other rect (LAYOUT_SPEC §9.1).
 *
 * Three outcomes:
 * - `popup`: a 4-row box centered over the focused panel (`N/M matches` and
 *   hints live inside it, so it needs no other chrome).
 * - `bar`: the focused panel has no rect here (detail fullscreen, zoomed-away)
 *   or is too narrow for a box — a 1-row input replaces the footer row.
 * - `none`: TOO_SMALL owns the frame for its message; typing state persists in
 *   the reducer and Esc still clears, but nothing is drawn.
 */

export const FILTER_POPUP_H = 4;
export const FILTER_POPUP_MAX_W = 44;
/** Below this a box cannot fit title + input; fall back to the footer bar. */
export const FILTER_POPUP_MIN_W = 24;

export type FilterPopupPlacement =
  | { kind: "popup"; rect: Rect }
  | { kind: "bar" }
  | { kind: "none" };

export function computeFilterPopupRect(
  layout: Layout,
  panelId: PanelId,
): FilterPopupPlacement {
  if (layout.message) return { kind: "none" };

  const panel = layout.panels.find((p) => p.id === panelId);
  if (!panel) return layout.footer ? { kind: "bar" } : { kind: "none" };

  const w = Math.min(panel.w - 4, FILTER_POPUP_MAX_W);
  if (w < FILTER_POPUP_MIN_W) return layout.footer ? { kind: "bar" } : { kind: "none" };

  const x = Math.min(Math.max(0, panel.x + Math.floor((panel.w - w) / 2)), layout.cols - w);
  // Below the header row, above the footer row.
  const top = 1;
  const bottom = layout.rows - 1 - FILTER_POPUP_H;
  if (bottom < top) return layout.footer ? { kind: "bar" } : { kind: "none" };
  const y = Math.min(Math.max(top, panel.y + Math.floor((panel.h - FILTER_POPUP_H) / 2)), bottom);

  return { kind: "popup", rect: { x, y, w, h: FILTER_POPUP_H } };
}