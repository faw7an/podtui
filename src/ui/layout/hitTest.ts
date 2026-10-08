import { PANEL_IDS, type Layout, type PanelId } from "./types.ts";
import { panelMetrics } from "./panelView.ts";
import { windowRows } from "../render/panelLines.ts";
import { buildHeader } from "../render/chrome.ts";
import { stripAnsi } from "../render/palette.ts";
import { displayWidth } from "../../util/fit.ts";
import type { FrameModel } from "../view/model.ts";
import type { Theme } from "../../theme/theme.ts";

/**
 * What is under a cell (P7-T7). Pure, and computed from the same `Layout`
 * and model the renderer draws, so a resize can never leave stale targets.
 *
 * Geometry mirrored from the renderers (and pinned by tests that render and
 * click the same frame): panel top border `╭─[N] Title…` with `[N]` in
 * cells x+2..x+4; then an optional column-header row; then item rows
 * windowed by `windowRows`; the detail pane's tab strip is its 2nd row with
 * labels separated by one space from x+1.
 */

export type Hit =
  | { kind: "headerTab"; id: PanelId }
  | { kind: "panelNumber"; id: PanelId }
  | { kind: "panelTitle"; id: PanelId }
  | { kind: "panelRow"; id: PanelId; itemId: string }
  | { kind: "panelBody"; id: PanelId }
  | { kind: "detailTab"; index: number }
  | { kind: "detailBody" }
  | { kind: "none" };

const inside = (x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/**
 * Header tab ranges: the header shows the six panel numbers in order (in
 * every style: full, short, numbers only), and labels contain no digits, so
 * each tab runs from its number to just before the next one. Anything after
 * the 6th tab (the clock) is not a tab.
 */
export function headerTabRanges(layout: Layout, model: FrameModel, theme: Theme): { id: PanelId; x0: number; x1: number }[] {
  if (!layout.header) return [];
  const text = stripAnsi(buildHeader(layout, model, { theme, color: false }));
  const cells = [...new Intl.Segmenter().segment(text)].map((s) => s.segment);
  const starts: number[] = [];
  let col = 0;
  let want = 1;
  for (const ch of cells) {
    if (want <= PANEL_IDS.length && ch === String(want) && col > 0) {
      starts.push(col - 1); // include the tab's leading space
      want++;
    }
    col += displayWidth(ch);
  }
  if (starts.length !== PANEL_IDS.length) return [];
  return PANEL_IDS.map((id, i) => {
    const x0 = starts[i] ?? 0;
    const next = starts[i + 1];
    // The last tab: its number, label and trailing space.
    const x1 = next ?? x0 + 2 + displayWidth(model.panels.find((p) => p.id === id)?.title ?? "") + 2;
    return { id, x0, x1 };
  });
}

export function hitTest(layout: Layout, model: FrameModel, theme: Theme, x: number, y: number): Hit {
  if (layout.message) return { kind: "none" };

  if (layout.header && y === layout.header.y) {
    const tab = headerTabRanges(layout, model, theme).find((t) => x >= t.x0 && x < t.x1);
    return tab ? { kind: "headerTab", id: tab.id } : { kind: "none" };
  }

  for (const rect of layout.panels) {
    if (!inside(x, y, rect)) continue;
    const id = rect.id;
    const m = panelMetrics(rect.h);
    if (m.collapsed || y === rect.y) {
      // `[N]` sits at x+2..x+4 on the top border; the collapsed strip starts
      // with it too.
      const numberAt = m.collapsed ? rect.x : rect.x + 2;
      return x >= numberAt && x < numberAt + 3 ? { kind: "panelNumber", id } : { kind: "panelTitle", id };
    }
    const panel = model.panels.find((p) => p.id === id);
    const firstRowY = rect.y + 1 + (m.showHeader ? 1 : 0);
    const slot = y - firstRowY;
    if (!panel || slot < 0 || slot >= m.dataRows) return { kind: "panelBody", id };
    const shown = windowRows(panel.items, panel.selected, m.dataRows);
    const item = shown.rows[slot];
    return item ? { kind: "panelRow", id, itemId: item.id } : { kind: "panelBody", id };
  }

  const d = layout.detail;
  if (d && inside(x, y, d)) {
    if (y === d.y + 1) {
      let at = d.x + 1;
      for (const [index, label] of model.detail.tabs.entries()) {
        const w = displayWidth(label);
        if (x >= at && x < at + w) return { kind: "detailTab", index };
        at += w + 1;
      }
      return { kind: "detailBody" };
    }
    return { kind: "detailBody" };
  }
  return { kind: "none" };
}
