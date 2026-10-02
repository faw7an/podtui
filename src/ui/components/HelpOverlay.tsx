import React from "react";
import { Text } from "ink";
import { renderHelp } from "../render/help.ts";
import { defaultTheme } from "../../theme/theme.ts";

/**
 * The `?` help overlay (ROADMAP P2-T8). Renders the pre-composed help buffer;
 * like `Frame` it never lets Ink measure or wrap anything.
 */
export function HelpOverlay({
  size,
  theme = defaultTheme,
  color = true,
}: {
  size: { cols: number; rows: number };
  theme?: typeof defaultTheme;
  color?: boolean;
}) {
  const lines = renderHelp(size, theme, color);
  return (
    <>
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </>
  );
}
