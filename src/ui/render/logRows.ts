import type { Theme } from "../../theme/theme.ts";
import type { LogLine } from "../../util/logBuffer.ts";
import { sanitizeLogText } from "../../util/logText.ts";
import { formatLogTimestamp } from "../../util/format.ts";
import { matchRanges } from "../view/logSearch.ts";
import { bg, bold, dim, fg, paint } from "./palette.ts";

/**
 * Turn one log line into painted terminal rows (P3-T3/T4/T5).
 *
 * Styling is decided per character first — dim timestamp, level colour,
 * search highlight — and only then cut into rows, so wrapping can never split
 * an escape sequence and a highlight survives a row break. Rows are plain
 * runs of SGR + text + reset; nothing stays open past a row.
 */

export interface LogRowOptions {
  theme: Theme;
  color: boolean;
  timestamps?: boolean;
  /** Search query to highlight (literal, case-insensitive). */
  query?: string;
  /** This line is the one `n`/`N` landed on: stronger highlight. */
  current?: boolean;
  /** Wrap to this many cells; omit for one row (the renderer truncates). */
  wrapWidth?: number;
}

type Style = "stamp" | "text" | "match" | "currentMatch";

function levelCodes(line: LogLine, theme: Theme): string[] {
  switch (line.level) {
    case "error":
      return [fg(theme.error)];
    case "warn":
      return [fg(theme.warn)];
    case "debug":
      return [dim()];
    default:
      return [];
  }
}

function codesFor(style: Style, line: LogLine, theme: Theme): string[] {
  switch (style) {
    case "stamp":
      return [dim()];
    case "match":
      return [bg(theme.warn), fg(theme.selectionFg)];
    case "currentMatch":
      return [bg(theme.accent), fg(theme.selectionFg), bold()];
    default:
      return levelCodes(line, theme);
  }
}

/** Split text into grapheme cells with their widths (wide CJK counts 2). */
function cells(text: string): { s: string; w: number; at: number }[] {
  const out: { s: string; w: number; at: number }[] = [];
  const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const { segment, index } of seg.segment(text)) {
    out.push({ s: segment, w: Bun.stringWidth(segment), at: index });
  }
  return out;
}

export function renderLogRows(line: LogLine, opts: LogRowOptions): string[] {
  const stamp = opts.timestamps ? `${formatLogTimestamp(line.timestamp)} ` : "";
  const body = sanitizeLogText(line.text);
  const plain = stamp + body;

  // Per code-unit style. Matches are searched in the body only, so a query
  // like "2026" does not light up every timestamp.
  const style: Style[] = new Array<Style>(plain.length).fill("text");
  for (let i = 0; i < stamp.length; i++) style[i] = "stamp";
  if (opts.query) {
    for (const [a, b] of matchRanges(body, opts.query)) {
      for (let i = a; i < b; i++) style[stamp.length + i] = opts.current ? "currentMatch" : "match";
    }
  }

  // Group graphemes into rows.
  const rows: { s: string; w: number; at: number }[][] = [[]];
  let used = 0;
  for (const cell of cells(plain)) {
    const width = opts.wrapWidth;
    if (width !== undefined && width > 0 && used + cell.w > width && used > 0) {
      rows.push([]);
      used = 0;
    }
    rows[rows.length - 1]?.push(cell);
    used += cell.w;
  }

  return rows.map((row) => {
    if (!opts.color) return row.map((c) => c.s).join("");
    let out = "";
    let runStyle: Style | null = null;
    let run = "";
    const flush = (): void => {
      if (run !== "" && runStyle !== null) out += paint(run, codesFor(runStyle, line, opts.theme));
      run = "";
    };
    for (const c of row) {
      const st = style[c.at] ?? "text";
      if (st !== runStyle) {
        flush();
        runStyle = st;
      }
      run += c.s;
    }
    flush();
    return out;
  });
}
