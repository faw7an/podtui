import type { Layout } from "../layout/types.ts";
import type { Theme } from "../../theme/theme.ts";
import type { FrameModel } from "../view/model.ts";
import { LineBuffer } from "./compose.ts";
import { buildFooter, buildHeader, type FooterHintContext } from "./chrome.ts";
import { renderDetail, renderMessage } from "./detailLines.ts";
import { renderPanel } from "./panelLines.ts";

export interface FrameOptions {
  theme: Theme;
  /** Set false for NO_COLOR frames. */
  color?: boolean;
  /** Overrides the model-derived footer hint context (P2-T8). */
  hintContext?: FooterHintContext;
  /** Detail content scroll offset in rows (P2-T7). */
  detailScroll?: number;
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

  if (layout.footer) {
    buffer.write(
      0,
      layout.footer.y,
      buildFooter(layout, model, { theme: opts.theme, color: on, context: opts.hintContext }),
    );
  }

  return buffer.toLines();
}
