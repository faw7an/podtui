import { defaultTheme, lightTheme, type Theme } from "./theme.ts";

/**
 * Omarchy theme support (P7-T1..T3).
 *
 * Verified from Omarchy's own source (github.com/basecamp/omarchy, branch
 * `quattro`, commit b83d3df, 2026-10-08; fixtures in test/fixtures/omarchy/):
 * - the active theme is a directory at `~/.local/state/omarchy/current/theme`
 *   (`bin/omarchy-theme-set`: CURRENT_THEME_PATH). Older releases used
 *   `~/.config/omarchy/current/theme`; it is tried second.
 * - every theme ships `colors.toml` (the script generates it from
 *   `alacritty.toml` for themes that predate it), flat TOML:
 *   `mode` ("dark"/"light"), `accent`, `selection`, `muted`, `background`
 *   (+ dark/darker/lighter), `foreground` (+ dark/light/bright), and named
 *   colours `red yellow orange green cyan blue magenta brown` plus
 *   `bright_*`. `white` lacks `orange` and `brown`.
 * - switching themes REPLACES the directory (`rm -rf` + `mv`), so a watcher
 *   must watch the parent, not the directory itself.
 */

export const OMARCHY_THEME_DIRS = (home: string): string[] => [
  `${home}/.local/state/omarchy/current/theme`,
  `${home}/.config/omarchy/current/theme`,
];

export interface OmarchyPalette {
  mode: "dark" | "light";
  colors: Partial<Record<string, string>>;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Parse `colors.toml`; only well-formed `#rrggbb` values are kept. */
export function parseOmarchyColors(text: string): OmarchyPalette {
  const raw = Bun.TOML.parse(text) as Record<string, unknown>;
  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string" && HEX.test(v.trim())) colors[k] = v.trim().toLowerCase();
  }
  return { mode: raw["mode"] === "light" ? "light" : "dark", colors };
}

// ---------------------------------------------------------------- contrast

const channel = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG 2 contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Text colours must stay readable on the background: 3:1 is WCAG's floor for
 * large/UI text, which status words in a TUI effectively are. The first
 * candidate that clears it wins; otherwise the most readable one.
 */
export const MIN_CONTRAST = 3;

const toHex = (rgb: number[]): string => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
const rgbOf = (hex: string): number[] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Keep the hue, move toward `toward` (the theme's foreground) in small steps
 * until the colour reads on `background`. A faint yellow on a light theme
 * becomes a darker yellow — not an orange that would read as an error.
 */
export function withContrast(color: string, background: string, toward: string): string {
  const [a, b] = [rgbOf(color), rgbOf(toward)];
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const mixed = toHex(a.map((v, i) => v + ((b[i] ?? v) - v) * t));
    if (contrast(mixed, background) >= MIN_CONTRAST) return mixed;
  }
  return toward;
}

function readable(background: string, candidates: (string | undefined)[], toward?: string): string | undefined {
  const valid = candidates.filter((c): c is string => c !== undefined && HEX.test(c));
  const first = valid[0];
  if (first === undefined) return undefined;
  if (contrast(first, background) >= MIN_CONTRAST) return first;
  if (toward && HEX.test(toward)) return withContrast(first, background, toward);
  return valid.find((c) => contrast(c, background) >= MIN_CONTRAST) ?? valid.sort((x, y) => contrast(y, background) - contrast(x, background))[0];
}

// ----------------------------------------------------------------- mapping

/**
 * Map a palette to podtui's roles (P7-T3). A role the palette cannot fill
 * falls back to podtui's own theme for that mode, role by role.
 */
export function themeFromPalette(p: OmarchyPalette, name: string): Theme {
  const base = p.mode === "light" ? lightTheme : defaultTheme;
  const c = p.colors;
  const bgc = c["background"] ?? base.background;
  const fgc = c["foreground"] ?? base.foreground;
  const text = (...keys: string[]): string | undefined => readable(bgc, keys.map((k) => c[k]), fgc);

  const error = text("red", "bright_red") ?? base.error;
  const warn = text("yellow", "bright_yellow", "orange") ?? base.warn;
  const ok = text("green", "bright_green") ?? base.ok;
  const accent = text("accent", "blue", "bright_blue") ?? base.accent;
  const dimmed = c["dark_foreground"] ?? c["muted"] ?? base.dim;
  // Selected rows paint text ON the accent: pick whichever of the theme's
  // background/foreground reads better there.
  const selectionFg = readable(accent, [c["background"], c["foreground"], base.selectionFg]) ?? base.selectionFg;

  return {
    name: `omarchy:${name}`,
    ok,
    warn,
    error,
    dim: dimmed,
    accent,
    border: c["muted"] ?? base.border,
    selectionBg: accent,
    selectionFg,
    background: bgc,
    foreground: c["foreground"] ?? base.foreground,
    panelTitle: dimmed,
    panelTitleFocused: accent,
    helpKey: accent,
    helpDesc: dimmed,
    statusOk: ok,
    statusWarn: warn,
    statusError: error,
    filter: text("magenta", "bright_magenta") ?? base.filter,
  };
}

export type ThemeLoad =
  | { kind: "omarchy"; theme: Theme; path: string }
  | { kind: "default"; theme: Theme; reason: string };

/**
 * Find and load the active Omarchy theme. Never throws: anything missing or
 * malformed yields podtui's default theme with the reason (P7-T4 shows it).
 */
export async function loadOmarchyTheme(
  home: string,
  read: (path: string) => Promise<string | null> = async (path) => {
    const f = Bun.file(path);
    return (await f.exists()) ? f.text() : null;
  },
): Promise<ThemeLoad> {
  for (const dir of OMARCHY_THEME_DIRS(home)) {
    const path = `${dir}/colors.toml`;
    const text = await read(path);
    if (text === null) continue;
    try {
      const palette = parseOmarchyColors(text);
      const nameText = await read(`${dir}.name`);
      const name = nameText?.trim() || dir.split("/").at(-1) || "theme";
      return { kind: "omarchy", theme: themeFromPalette(palette, name), path };
    } catch (e) {
      return { kind: "default", theme: defaultTheme, reason: `${path}: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  return { kind: "default", theme: defaultTheme, reason: "no Omarchy theme found" };
}
