import { test, expect, describe } from "bun:test";
import { defaultTheme, lightTheme, getTheme, type Theme } from "../src/theme/theme.ts";

describe("theme", () => {
  test("defaultTheme has all required colors", () => {
    const requiredKeys = [
      "ok", "warn", "error", "dim", "accent", "border",
      "selectionBg", "selectionFg", "background", "foreground",
      "panelTitle", "panelTitleFocused", "helpKey", "helpDesc",
      "statusOk", "statusWarn", "statusError", "filter"
    ] as const;

    for (const key of requiredKeys) {
      expect(defaultTheme[key]).toBeDefined();
      expect(typeof defaultTheme[key]).toBe("string");
      expect(defaultTheme[key].length).toBeGreaterThan(0);
    }
  });

  test("lightTheme has all required colors", () => {
    const requiredKeys = [
      "ok", "warn", "error", "dim", "accent", "border",
      "selectionBg", "selectionFg", "background", "foreground",
      "panelTitle", "panelTitleFocused", "helpKey", "helpDesc",
      "statusOk", "statusWarn", "statusError", "filter"
    ] as const;

    for (const key of requiredKeys) {
      expect(lightTheme[key]).toBeDefined();
      expect(typeof lightTheme[key]).toBe("string");
      expect(lightTheme[key].length).toBeGreaterThan(0);
    }
  });

  test("themes have different background/foreground", () => {
    expect(defaultTheme.background).not.toBe(lightTheme.background);
    expect(defaultTheme.foreground).not.toBe(lightTheme.foreground);
  });

  test("getTheme returns correct theme", () => {
    expect(getTheme("default")).toBe(defaultTheme);
    expect(getTheme("light")).toBe(lightTheme);
    expect(getTheme("unknown")).toBe(defaultTheme);
  });

  test("all colors are valid hex or named", () => {
    const isValidColor = (color: string) => /^#[0-9a-fA-F]{6}$/.test(color) || /^[a-z]+$/.test(color);
    
    for (const key of Object.keys(defaultTheme) as (keyof Theme)[]) {
      const color = defaultTheme[key];
      expect(isValidColor(color)).toBe(true);
    }
  });
});