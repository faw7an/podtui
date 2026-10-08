import type { Layout, Rect } from "../layout/types.ts";
import { innerWidth } from "../layout/panelView.ts";
import type { Theme } from "../../theme/theme.ts";
import { displayWidth, fit, padRight, truncate } from "../../util/fit.ts";
import type { DetailLogModel, DetailModel, DetailStatsModel } from "../view/model.ts";
import { STATS_HISTORY, sparkline, statsRows } from "../view/statsView.ts";
import { logWindow } from "../view/logView.ts";
import type { LogLine } from "../../util/logBuffer.ts";
import { renderLogRows } from "./logRows.ts";
import { matchCount } from "../view/logSearch.ts";
import { LABEL_W, MASK } from "../view/detail.ts";
import { bg, bold, dim, fg, paint, RESET } from "./palette.ts";

const TL = "╭";
const TR = "╮";
const BL = "└";
const BR = "┘";
const H = "─";
const V = "│";

export interface DetailOptions {
  theme: Theme;
  /** True when the detail pane owns the whole body (mode S / zoom). */
  prominent?: boolean;
  color?: boolean;
  /** Content scroll offset in rows (PgUp/PgDn); clamped to the content. */
  scroll?: number;
}

/**
 * Paint one content row: section headings bold in the accent colour, the
 * fixed-width key cell in the accent colour, values default. A row only gets
 * the key treatment when the key cell boundary is exact (cell 13 is a space):
 * overlong keys fall back to plain rather than tearing mid-key. Placeholders
 * (`no selection`, `not implemented yet`) match neither rule and stay plain.
 */
function paintContent(line: string, theme: Theme, on: boolean): string {
  if (!on) return line;
  if (line.startsWith("# ")) return paint(line, [fg(theme.accent), bold()]);
  if (line.length > LABEL_W && line[LABEL_W - 1] === " ") {
    return paint(line.slice(0, LABEL_W), [fg(theme.accent)]) + line.slice(LABEL_W);
  }
  return line;
}

/**
 * One Env row (P3-T6): the name plain, the value in the accent colour, a
 * masked value dim so it reads as "hidden", not as a value of asterisks.
 */
function paintEnvRow(line: string, keyWidth: number, theme: Theme, on: boolean): string {
  if (!on || line.length <= keyWidth) return line;
  const key = line.slice(0, keyWidth);
  const value = line.slice(keyWidth);
  return key + paint(value, [value === MASK ? dim() : fg(theme.accent)]);
}

const STATS_LABEL_W = 11;

/**
 * The Stats tab (P3-T7): one row per measure, sparklines under CPU and
 * memory sized to the pane (newest sample on the right).
 */
function statsContent(stats: DetailStatsModel, budget: number, width: number, theme: Theme, on: boolean): string[] {
  const { status, history } = stats;
  if (stats.state !== "running") {
    return [
      messageRow(`${stats.name} is not running (${stats.state || "unknown"}).`, on),
      messageRow("Stats are shown for running containers.", on),
    ];
  }
  if (status.kind === "error") return [messageRow(`Stats unavailable: ${status.message}`, on, theme.error)];
  const rows = statsRows(history);
  if (rows.length === 0) {
    return [messageRow(status.kind === "ended" ? "The stats stream ended." : "Waiting for the first sample…", on)];
  }
  const sparkW = Math.max(0, Math.min(STATS_HISTORY, width - STATS_LABEL_W));
  const out: string[] = [];
  for (const row of rows) {
    out.push(`${paint(row.label.padEnd(STATS_LABEL_W), on ? [fg(theme.accent)] : [])}${row.value}`);
    if (row.spark && sparkW > 0) {
      out.push(" ".repeat(STATS_LABEL_W) + paint(sparkline(row.spark.values, sparkW, row.spark.max), on ? [fg(theme.ok)] : []));
    }
  }
  return out.slice(0, budget);
}

interface ContentWindow {
  /** Ready-to-place rows (may carry colour); `fit` still trims each to width. */
  rows: string[];
  /** Bottom-border hint text, unpainted. */
  hint: string;
}

function messageRow(text: string, on: boolean, color?: string): string {
  return paint(text, on ? [color ? fg(color) : dim()] : []);
}

/**
 * One log row without wrapping (P3-T3): the whole line takes its level's
 * colour — error red, warn yellow, debug dim, everything else the terminal
 * default. See `renderLogRows` for the full painter.
 */
export function paintLogLine(line: LogLine, theme: Theme, on: boolean, timestamps = false): string {
  return renderLogRows(line, { theme, color: on, timestamps })[0] ?? "";
}

/** The errors-only predicate (`e`). */
export const errorsOnly = (line: LogLine): boolean => line.level === "error";

/**
 * The Logs tab: only the lines inside the window are sanitized and formatted,
 * so a 5,000-line buffer costs no more to draw than a screenful.
 */
function logContent(log: DetailLogModel, budget: number, width: number, theme: Theme, on: boolean): ContentWindow {
  const show = log.errorsOnly ? errorsOnly : undefined;
  const win = logWindow(log.view, log.source, budget, show);
  const { status } = log;
  const search = log.search;
  const query = search && search.query !== "" ? search.query : undefined;
  const rows = win.lines.flatMap((line) =>
    renderLogRows(line, {
      theme,
      color: on,
      timestamps: log.timestamps,
      query,
      current: query !== undefined && search?.current === line.seq,
      wrapWidth: log.wrap ? width : undefined,
    }),
  );
  // Wrapped lines can need more rows than fit; the view is bottom-anchored,
  // so the oldest rows are the ones that give way.
  if (rows.length > budget) rows.splice(0, rows.length - budget);

  if (rows.length === 0 && budget > 0) {
    if (status.kind === "error") rows.push(messageRow(`Logs unavailable: ${status.message}`, on, theme.error));
    else if (status.kind === "connecting") rows.push(messageRow("Connecting to the log stream…", on));
    else if (log.errorsOnly && log.source.nextSeq > log.source.firstSeq) rows.push(messageRow("No error lines. Press e to show all lines.", on));
    else if (status.kind === "ended") rows.push(messageRow("No log output; the stream has ended.", on));
    else rows.push(messageRow("No log output yet.", on));
  }

  const parts: string[] = [];
  if (search?.typing) parts.push(`/${search.query}▌`);
  else if (query !== undefined) {
    const { total, index } = matchCount(log.source, query, search?.current ?? null, show);
    parts.push(total === 0 ? `/${query} no match` : `/${query} ${index ?? "-"}/${total}`);
  }
  if (log.view.mode === "paused") parts.push("PAUSED");
  if (log.errorsOnly) parts.push("errors only");
  if (win.below > 0) parts.push(`↓${win.below} new`);
  if (status.kind === "ended" && win.lines.length > 0) parts.push("stream ended");
  if (status.kind === "error" && win.lines.length > 0) parts.push(`error: ${status.message}`);
  return { rows, hint: parts.length > 0 ? ` ${parts.join(" · ")} ` : "" };
}

/**
 * Render the detail pane into exactly `rect.h` lines of exactly `rect.w` cells.
 *
 * Anatomy (LAYOUT_SPEC §7): border, title row, a one-row internal tab strip,
 * then windowed content. Long lines truncate with `…`; the renderer never
 * wraps, which is why Ink's wrapping can never add a row here.
 */
export function renderDetail(
  rect: Rect,
  detail: DetailModel,
  opts: DetailOptions,
): string[] {
  const { theme } = opts;
  const on = opts.color !== false;
  const w = rect.w;
  const iw = innerWidth(w);
  const bc = on ? fg(opts.prominent ? theme.accent : theme.border) : "";
  const lines: string[] = [];

  // Top border with the title.
  const title = fit(detail.title || "(no selection)", Math.max(0, iw - 1));
  const fill = Math.max(0, iw - displayWidth(title) - 1);
  lines.push(
    `${bc}${TL}${H}${on ? fg(opts.prominent ? theme.accent : theme.panelTitle) : ""}${title}${
      on ? RESET : ""
    }${bc}${H.repeat(fill)}${TR}${on ? RESET : ""}`,
  );

  const innerRows = Math.max(0, rect.h - 2);
  const tabText = detail.tabs
    .map((t, i) =>
      i === detail.activeTab
        ? paint(t, [on ? bg(theme.accent) : "", on ? fg(theme.selectionFg) : "", on ? bold() : ""])
        : paint(t, [on ? dim() : ""]),
    )
    .join(" ");
  const tabStrip = fit(tabText, iw);
  const hasTabs = detail.tabs.length > 0;

  const contentBudget = Math.max(0, innerRows - (hasTabs ? 1 : 0));
  // Pager semantics, not selection-follow: the offset is the top row, clamped
  // so the last window is full. (windowRows centers its anchor instead, which
  // is what panels want and detail does not.)
  let rows: string[];
  let hint: string;
  if (detail.stats) {
    rows = statsContent(detail.stats, contentBudget, iw, theme, on);
    hint = detail.stats.status.kind === "live" ? " live · 1 s " : "";
  } else if (detail.log) {
    ({ rows, hint } = logContent(detail.log, contentBudget, iw, theme, on));
  } else {
    const env = detail.env;
    // A table keeps its header row on screen and scrolls only the body.
    const header = detail.table ? detail.lines[0] : undefined;
    const body = header !== undefined ? detail.lines.slice(1) : detail.lines;
    const room = Math.max(0, contentBudget - (header !== undefined ? 1 : 0));
    const bodyTop = Math.min(Math.max(0, opts.scroll ?? 0), Math.max(0, body.length - room));
    const shown = body.slice(bodyTop, bodyTop + room);
    rows = [
      ...(header !== undefined && contentBudget > 0 ? [paint(header, on ? [fg(theme.accent), bold()] : [])] : []),
      ...shown.map((line) =>
        detail.table ? line : env ? paintEnvRow(line, env.keyWidth, theme, on) : paintContent(line, theme, on),
      ),
    ];
    const hiddenBelow = body.length - bodyTop - shown.length;
    const parts = [detail.hint, hiddenBelow > 0 ? `↓${hiddenBelow} more` : undefined].filter(
      (p): p is string => p !== undefined,
    );
    hint = parts.length > 0 ? ` ${parts.join(" · ")} ` : "";
  }

  for (let i = 0; i < innerRows; i++) {
    let inner: string;
    if (hasTabs && i === 0) {
      inner = padRight(tabStrip, iw);
    } else {
      const slot = i - (hasTabs ? 1 : 0);
      const line = slot >= 0 ? rows[slot] : undefined;
      inner = line === undefined ? padRight("", iw) : padRight(fit(line, iw), iw);
    }
    lines.push(`${bc}${V}${on ? RESET : ""}${inner}${bc}${V}${on ? RESET : ""}`);
  }

  // Fit the hint: an error message can be longer than the border.
  const hintText = hint.length > 0 ? paint(truncate(hint, Math.max(0, iw - 1)), [on ? dim() : ""]) : "";
  const bottomFill = Math.max(0, iw - displayWidth(hintText));
  lines.push(`${bc}${BL}${H.repeat(bottomFill)}${hintText}${bc}${BR}${on ? RESET : ""}`);

  return lines;
}

/** Centred message used for the TOO_SMALL breakpoint (LAYOUT_SPEC §5). */
export function renderMessage(
  layout: Layout,
  text: string,
  theme: Theme,
  color = true,
): string[] {
  const out: string[] = [];
  const mid = Math.floor(layout.rows / 2);
  const bc = color ? fg(theme.error) : "";
  out.push(paint(fit(text, layout.cols), color ? [bc] : []));
  // Pad to the full frame height so the row count stays exact.
  for (let i = 0; i < layout.rows; i++) {
    if (i === mid) continue;
    out[i] ??= " ".repeat(layout.cols);
  }
  return out.slice(0, layout.rows);
}
