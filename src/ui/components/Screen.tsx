import React, { useMemo } from "react";
import { Frame } from "./Frame.tsx";
import { computeLayout } from "../layout/computeLayout.ts";
import { useTerminalSize, type TerminalSize } from "../hooks/useTerminalSize.ts";
import type { PanelId, PaneId } from "../layout/types.ts";
import type { Theme } from "../../theme/theme.ts";
import type { FrameModel } from "../view/model.ts";
import type { FooterHintContext } from "../render/chrome.ts";

export interface ScreenProps {
  model: FrameModel;
  theme: Theme;
  visible: ReadonlySet<PanelId>;
  zoom: PaneId | null;
  detailFullscreen: boolean;
  /**
   * Overrides the detected terminal size. Production leaves this unset and the
   * size comes from `useWindowSize()`; tests pass it explicitly rather than
   * going through React context (see useTerminalSize.ts for why).
   */
  size?: TerminalSize;
  color?: boolean;
  /** Overrides the model-derived footer hint context (P2-T8). */
  hintContext?: FooterHintContext;
  /** Detail content scroll offset in rows (P2-T7). */
  detailScroll?: number;
}

/**
 * The reactive frame: reads the terminal size, recomputes the layout, and hands
 * it to the pure renderer.
 *
 * `Frame` deliberately takes a fixed `Layout` so it can be tested as a pure
 * function of a rectangle. This component is the only place that turns a
 * terminal size into a layout, which is why a real resize re-lays out correctly
 * (and why the previous design, where `App` computed the layout, needed
 * threading size through by hand).
 */
export function Screen({
  model,
  theme,
  visible,
  zoom,
  detailFullscreen,
  size,
  color = true,
  hintContext,
  detailScroll,
}: ScreenProps) {
  const detected = useTerminalSize();
  const { columns, rows } = size ?? detected;

  const layout = useMemo(
    () =>
      computeLayout({
        cols: columns,
        rows,
        visible,
        focused: model.focus,
        zoom,
        detailFullscreen,
      }),
    [columns, rows, visible, model.focus, zoom, detailFullscreen],
  );

  return (
    <Frame
      layout={layout}
      model={model}
      theme={theme}
      color={color}
      hintContext={hintContext}
      detailScroll={detailScroll}
    />
  );
}
