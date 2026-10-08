import { Text } from "ink";
import type { Layout, PanelId } from "../layout/types.ts";
import type { Theme } from "../../theme/theme.ts";
import type { FrameModel } from "../view/model.ts";
import { renderFrame } from "../render/frame.ts";
import type { FooterHintContext } from "../render/chrome.ts";
import type { ConfirmDialogState } from "../view/confirmDialog.ts";

export interface FrameProps {
  layout: Layout;
  model: FrameModel;
  theme: Theme;
  color?: boolean;
  hintContext?: FooterHintContext;
  detailScroll?: number;
  filterPopup?: PanelId | null;
  dialog?: ConfirmDialogState | null;
}

/**
 * Draws a pre-composed frame.
 *
 * One `<Text>` per line, each already exactly `cols` cells wide. There is no
 * Box nesting and no flex layout here by design: Ink must never be asked to
 * measure or wrap anything, because it does not clip (verified). See
 * `src/ui/render/frame.ts` and the LAYOUT_SPEC §8 decision in DECISIONS.md.
 */
export function Frame({ layout, model, theme, color = true, hintContext, detailScroll, filterPopup, dialog }: FrameProps) {
  const lines = renderFrame(layout, model, { theme, color, hintContext, detailScroll, filterPopup, dialog });
  return (
    <>
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </>
  );
}
