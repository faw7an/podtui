/**
 * Omarchy themes (P7-T2/T3), from real colors.toml files copied from
 * Omarchy's repository (test/fixtures/omarchy/SOURCE.txt).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  MIN_CONTRAST,
  OMARCHY_THEME_DIRS,
  contrast,
  loadOmarchyTheme,
  parseOmarchyColors,
  themeFromPalette,
  withContrast,
} from "../src/theme/omarchy.ts";
import { defaultTheme, lightTheme } from "../src/theme/theme.ts";

const THEMES = ["tokyo-night", "catppuccin-latte", "gruvbox", "white", "matte-black"] as const;
const file = (t: string): string => readFileSync(`test/fixtures/omarchy/${t}.colors.toml`, "utf8");

describe("parseOmarchyColors", () => {
  test("mode and colours from a dark and a light theme", () => {
    const tn = parseOmarchyColors(file("tokyo-night"));
    expect(tn.mode).toBe("dark");
    expect(tn.colors).toMatchObject({ accent: "#7aa2f7", background: "#1a1b26", red: "#f7768e" });
    expect(parseOmarchyColors(file("catppuccin-latte")).mode).toBe("light");
  });

  test("only well-formed #rrggbb values are kept; an unknown mode is dark", () => {
    const p = parseOmarchyColors('mode = "sepia"\nred = "#zzzzzz"\ngreen = "#00FF00"\nnote = "hi"\n');
    expect(p).toEqual({ mode: "dark", colors: { green: "#00ff00" } });
  });

  test("invalid TOML throws (the loader turns that into the default theme)", () => {
    expect(() => parseOmarchyColors("mode = ")).toThrow();
  });
});

describe("themeFromPalette", () => {
  test.each(THEMES.map((t) => [t] as [string]))("%s: every status colour and selected text readable (≥ 3:1)", (t) => {
    const th = themeFromPalette(parseOmarchyColors(file(t)), t);
    for (const role of ["error", "warn", "ok", "accent"] as const) {
      expect(contrast(th[role], th.background)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
    expect(contrast(th.selectionFg, th.selectionBg)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  test("tokyo-night maps semantic keys straight through", () => {
    const th = themeFromPalette(parseOmarchyColors(file("tokyo-night")), "tokyo-night");
    expect(th).toMatchObject({ error: "#f7768e", warn: "#e0af68", ok: "#9ece6a", accent: "#7aa2f7", border: "#414868", background: "#1a1b26", filter: "#ad8ee6" });
    expect(th.name).toBe("omarchy:tokyo-night");
  });

  test("a faint yellow on a light theme is darkened, keeping its hue (not swapped for orange)", () => {
    const th = themeFromPalette(parseOmarchyColors(file("catppuccin-latte")), "latte");
    expect(th.warn).not.toBe("#d84e2b"); // the theme's orange
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(th.warn.slice(i, i + 2), 16)) as [number, number, number];
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b); // still a yellow/amber
  });

  test("missing roles fall back per role, to the light defaults for a light theme", () => {
    const th = themeFromPalette({ mode: "light", colors: { background: "#ffffff" } }, "bare");
    expect(th.error).toBe(lightTheme.error);
    expect(th.accent).toBe(lightTheme.accent);
    const dark = themeFromPalette({ mode: "dark", colors: {} }, "empty");
    expect(dark.ok).toBe(defaultTheme.ok);
  });

  test("withContrast moves toward the foreground only as far as needed", () => {
    const out = withContrast("#ffff00", "#ffffff", "#000000");
    expect(contrast(out, "#ffffff")).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(contrast(out, "#ffffff")).toBeLessThan(4.5);
  });
});

describe("loadOmarchyTheme", () => {
  const files = (map: Record<string, string>) => async (p: string) => map[p] ?? null;

  test("current path first: ~/.local/state/omarchy/current/theme", async () => {
    expect(OMARCHY_THEME_DIRS("/h")).toEqual(["/h/.local/state/omarchy/current/theme", "/h/.config/omarchy/current/theme"]);
    const r = await loadOmarchyTheme(
      "/h",
      files({
        "/h/.local/state/omarchy/current/theme/colors.toml": file("gruvbox"),
        "/h/.local/state/omarchy/current/theme.name": "gruvbox\n",
        "/h/.config/omarchy/current/theme/colors.toml": file("tokyo-night"),
      }),
    );
    expect(r).toMatchObject({ kind: "omarchy", path: "/h/.local/state/omarchy/current/theme/colors.toml" });
    expect(r.theme.name).toBe("omarchy:gruvbox");
  });

  test("the older ~/.config location is used when the state dir has none", async () => {
    const r = await loadOmarchyTheme("/h", files({ "/h/.config/omarchy/current/theme/colors.toml": file("tokyo-night") }));
    expect(r.kind).toBe("omarchy");
  });

  test("no Omarchy, or a broken file: the default theme with a reason", async () => {
    expect(await loadOmarchyTheme("/h", files({}))).toEqual({ kind: "default", theme: defaultTheme, reason: "no Omarchy theme found" });
    const broken = await loadOmarchyTheme("/h", files({ "/h/.local/state/omarchy/current/theme/colors.toml": "mode = " }));
    expect(broken.kind).toBe("default");
    if (broken.kind === "default") expect(broken.reason).toContain("colors.toml");
  });
});
