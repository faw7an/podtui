export interface Theme {
  name: string;
  ok: string;
  warn: string;
  error: string;
  dim: string;
  accent: string;
  border: string;
  selectionBg: string;
  selectionFg: string;
  background: string;
  foreground: string;
  panelTitle: string;
  panelTitleFocused: string;
  helpKey: string;
  helpDesc: string;
  statusOk: string;
  statusWarn: string;
  statusError: string;
  /** Active-filter chrome: panel border, badge, header marker. */
  filter: string;
}

export const defaultTheme: Theme = {
  name: "default",
  ok: "#00ff00",
  warn: "#ffff00",
  error: "#ff0000",
  dim: "#888888",
  accent: "#00ffff",
  border: "#444444",
  selectionBg: "#00ffff",
  selectionFg: "#000000",
  background: "#000000",
  foreground: "#ffffff",
  panelTitle: "#888888",
  panelTitleFocused: "#00ffff",
  helpKey: "#00ffff",
  helpDesc: "#888888",
  statusOk: "#00ff00",
  statusWarn: "#ffff00",
  statusError: "#ff0000",
  filter: "#ff5fff",
};

export const lightTheme: Theme = {
  name: "light",
  ok: "#008000",
  warn: "#b8860b",
  error: "#cc0000",
  dim: "#666666",
  accent: "#008080",
  border: "#cccccc",
  selectionBg: "#008080",
  selectionFg: "#ffffff",
  background: "#ffffff",
  foreground: "#000000",
  panelTitle: "#666666",
  panelTitleFocused: "#008080",
  helpKey: "#008080",
  helpDesc: "#666666",
  statusOk: "#008000",
  statusWarn: "#b8860b",
  statusError: "#cc0000",
  filter: "#a020f0",
};

export function getTheme(name: string): Theme {
  switch (name) {
    case "light":
      return lightTheme;
    default:
      return defaultTheme;
  }
}