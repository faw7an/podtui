import type { Layout } from "../layout/types.ts";
import type { Theme } from "../../theme/theme.ts";
import type { FrameModel } from "../view/model.ts";
import type { PanelId } from "../layout/types.ts";
import { LineBuffer } from "./compose.ts";
import { buildFooter, buildHeader, type FooterHintContext } from "./chrome.ts";
import { computeFilterPopupRect } from "../layout/filterPopup.ts";
import { renderDetail, renderMessage } from "./detailLines.ts";
import { renderFilterBar, renderFilterPopup, type FilterPopupData } from "./filterPopup.ts";
import { renderPanel } from "./panelLines.ts";
import { dialogRect, renderConfirmDialog } from "./confirmDialog.ts";
import type { ConfirmDialogState } from "../view/confirmDialog.ts";
import { bold, fg, paint } from "./palette.ts";
import { fit } from "../../util/fit.ts";

export interface FrameOptions {
  theme: Theme;
  /** Set false for NO_COLOR frames. */
  color?: boolean;
  /** Overrides the model-derived footer hint context (P2-T8). */
  hintContext?: FooterHintContext;
  /** Detail content scroll offset in rows (P2-T7). */
  detailScroll?: number;
  /**
   * Open filter popup for this panel (redesigned filter UX): a box over the
   * frame, or a bar replacing the footer when no box fits. The query lives in
   * the panel model's `filter` field; this only says the popup is open.
   */
  filterPopup?: PanelId | null;
  /** Open confirm dialog (P4-T6): drawn over everything except the header. */
  dialog?: ConfirmDialogState | null;
}

/**
 * Compose the entire frame into exactly `rows` lines of exactly `cols` cells.
 *
 * Every region is written at the rectangle `computeLayout` produced — there is
 * no flex, no auto-sizing and no nesting, so LAYOUT_SPEC §9 invariants 3 and 4
 * hold by construction rather than by luck.
 */
export function renderFrame(layout: Layout, model: FrameModel, opts: FrameOptions): string[] {
  const on = opts.color !== false;
  const buffer = new LineBuffer(layout.cols, layout.rows);

  // TOO_SMALL: one centred message, nothing else.
  if (layout.message) {
    const msg = renderMessage(layout, layout.message.text, opts.theme, on);
    for (let y = 0; y < msg.length; y++) buffer.write(0, y, msg[y] ?? "");
    return buffer.toLines();
  }

  if (layout.header) {
    buffer.write(0, layout.header.y, buildHeader(layout, model, { theme: opts.theme, color: on }));
  }

  for (const rect of layout.panels) {
    const panel = model.panels.find((p) => p.id === rect.id);
    if (!panel) continue;
    const lines = renderPanel(rect, panel, {
      theme: opts.theme,
      focused: rect.focused,
      color: on,
    });
    lines.forEach((line, i) => buffer.write(rect.x, rect.y + i, line));
  }

  const detailRect = layout.detail;
  if (detailRect) {
    const prominent = layout.breakpoint === "S" || model.focus === "detail";
    const lines = renderDetail(detailRect, model.detail, {
      theme: opts.theme,
      prominent,
      color: on,
      scroll: opts.detailScroll,
    });
    lines.forEach((line, i) => buffer.write(detailRect.x, detailRect.y + i, line));
  }

  // Filter popup overlay (redesigned filter UX): drawn after panels and
  // detail so it covers them, before the footer so the bar variant can take
  // the footer row. Never drawn over the TOO_SMALL message.
  let barData: FilterPopupData | null = null;
  if (opts.filterPopup && !layout.message) {
    const placement = computeFilterPopupRect(layout, opts.filterPopup);
    const panel = model.panels.find((p) => p.id === opts.filterPopup);
    const data: FilterPopupData | null =
      panel?.filter != null
        ? {
            panelTitle: panel.title,
            query: panel.filter.query,
            matched: panel.items.length,
            total: panel.filter.total,
          }
        : null;
    if (placement.kind === "popup" && data) {
      buffer.excise(placement.rect.x, placement.rect.y, placement.rect.w, placement.rect.h);
      const lines = renderFilterPopup(placement.rect, data, opts.theme, on);
      lines.forEach((line, i) => buffer.write(placement.rect.x, placement.rect.y + i, line));
    } else if (placement.kind === "bar") {
      barData = data;
    }
  }

  // Confirm dialog (P4-T6): over everything. When no box fits, a one-line
  // question replaces the footer, so the prompt is never invisible.
  let dialogBar: string | null = null;
  if (opts.dialog) {
    const rect = dialogRect(layout.cols, layout.rows, opts.dialog);
    if (rect) {
      buffer.excise(rect.x, rect.y, rect.w, rect.h);
      renderConfirmDialog(rect, opts.dialog, opts.theme, on).forEach((line, i) => buffer.write(rect.x, rect.y + i, line));
    } else {
      const text = `${opts.dialog.content.title} ${opts.dialog.content.lines[0] ?? ""} y/n`;
      dialogBar = paint(fit(text, layout.cols), on ? [fg(opts.theme.error), bold()] : []);
    }
  }

  if (dialogBar !== null && layout.footer) {
    buffer.write(0, layout.footer.y, dialogBar);
  } else if (layout.footer) {
    buffer.write(
      0,
      layout.footer.y,
      barData
        ? renderFilterBar(layout.cols, barData, opts.theme, on)
        : buildFooter(layout, model, { theme: opts.theme, color: on, context: opts.hintContext }),
    );
  }

  return buffer.toLines();
}
