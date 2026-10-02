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

export function fg(color: string): string {
  if (!colorEnabled()) return "";
  const [r, g, b] = hexToRgb(color);
  return `\u001B[38;2;${r};${g};${b}m`;
}

export function bg(color: string): string {
  if (!colorEnabled()) return "";
  const [r, g, b] = hexToRgb(color);
  return `\u001B[48;2;${r};${g};${b}m`;
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
