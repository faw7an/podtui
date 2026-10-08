import type { Theme } from "../../theme/theme.ts";
import { displayWidth } from "../../util/fit.ts";

/**
 * Minimal SGR emitter for the pre-composed line buffer.
 *
 * The frame is drawn as plain strings rather than nested Ink boxes, so we
 * produce the escape sequences ourselves. Hex theme colours become truecolor
 * SGR pairs, exactly like Ink does for hex values — we control every byte,
 * which is what makes the width arithmetic verifiable.
 *
 * `NO_COLOR` (https://no-color.org) disables colour entirely; the `▸` markers
 * still carry focus/selection meaning, so the UI degrades safely.
 */

const colorEnabled = (): boolean => {
  const noColor = process.env["NO_COLOR"];
  if (noColor !== undefined && noColor !== "") return false;
  return process.env["TERM"] !== "dumb";
};

const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return [255, 255, 255];
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

export const RESET = "\u001B[0m";
const BOLD = "\u001B[1m";
const DIM = "\u001B[2m";
const INVERSE = "\u001B[7m";

export type ColorDepth = "truecolor" | "256";

/**
 * Colour depth (P7-T5). `PODTUI_COLOR` forces it. Otherwise `COLORTERM`
 * (truecolor/24bit) means 24-bit; a `TERM` that advertises 256 colours
 * without `COLORTERM` (typical inside tmux/screen) gets 256; anything else
 * stays 24-bit, as before, so nothing that worked changes.
 */
export function colorDepth(env: Record<string, string | undefined> = process.env): ColorDepth {
  const forced = env["PODTUI_COLOR"];
  if (forced === "256" || forced === "truecolor") return forced;
  const ct = (env["COLORTERM"] ?? "").toLowerCase();
  if (ct === "truecolor" || ct === "24bit") return "truecolor";
  if (/256color/.test(env["TERM"] ?? "")) return "256";
  return "truecolor";
}

/** xterm's 6x6x6 cube levels and 24-step grey ramp (xterm 256colres). */
const CUBE = [0, 95, 135, 175, 215, 255];

/** Nearest xterm-256 index for an RGB colour (cube 16-231, greys 232-255). */
export function rgbTo256(r: number, g: number, b: number): number {
  const level = (v: number): number => CUBE.reduce((best, c, i) => (Math.abs(c - v) < Math.abs((CUBE[best] ?? 0) - v) ? i : best), 0);
  const [ri, gi, bi] = [level(r), level(g), level(b)];
  const cube = 16 + 36 * ri + 6 * gi + bi;
  const cubeRgb = [CUBE[ri] ?? 0, CUBE[gi] ?? 0, CUBE[bi] ?? 0];
  const avg = (r + g + b) / 3;
  const greyIndex = Math.min(23, Math.max(0, Math.round((avg - 8) / 10)));
  const grey = 8 + greyIndex * 10;
  const dist = (c: number[]): number => (c[0]! - r) ** 2 + (c[1]! - g) ** 2 + (c[2]! - b) ** 2;
  return dist([grey, grey, grey]) < dist(cubeRgb) ? 232 + greyIndex : cube;
}

function sgrColor(layer: 38 | 48, color: string): string {
  const [r, g, b] = hexToRgb(color);
  return colorDepth() === "256" ? `\u001B[${layer};5;${rgbTo256(r, g, b)}m` : `\u001B[${layer};2;${r};${g};${b}m`;
}

export function fg(color: string): string {
  if (!colorEnabled()) return "";
  return sgrColor(38, color);
}

export function bg(color: string): string {
  if (!colorEnabled()) return "";
  return sgrColor(48, color);
}

export const bold = (): string => (colorEnabled() ? BOLD : "");
export const dim = (): string => (colorEnabled() ? DIM : "");
export const inverse = (): string => (colorEnabled() ? INVERSE : "");

/** Wrap `text` in SGR codes, always emitting a reset when anything was set. */
export function paint(text: string, codes: string[]): string {
  const active = codes.filter((c) => c.length > 0);
  if (active.length === 0 || !colorEnabled()) return text;
  return `${active.join("")}${text}${RESET}`;
}

/** Convenience wrappers used by the frame builders. */
export const paintInverted = (text: string, theme: Theme, focused: boolean): string => {
  if (!focused) return text;
  // Reverse video must cover the full padded row, so the caller passes a
  // pre-padded string; we only add the codes here.
  return paint(text, [inverse(), bold(), bg(theme.selectionBg), fg(theme.selectionFg)]);
};

export const paintDim = (text: string, theme: Theme): string => paint(text, [dim(), fg(theme.dim)]);

export const paintAccent = (text: string, theme: Theme, strong = false): string =>
  paint(text, strong ? [bold(), fg(theme.accent)] : [fg(theme.accent)]);

/**
 * Strip every SGR sequence, for width assertions in tests.
 * The pattern is built from a char code so the source contains no raw control
 * character (which `no-control-regex` rightly rejects).
 */
const SGR_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export function stripAnsi(text: string): string {
  return text.replaceAll(SGR_RE, "");
}

/** Display width of `text` ignoring colour. */
export const visibleWidth = (text: string): number => displayWidth(stripAnsi(text));
