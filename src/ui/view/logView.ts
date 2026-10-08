import type { LogLine } from "../../util/logBuffer.ts";

/**
 * Where the Logs tab is looking (P3-T2, P3-T4). Pure: no Ink, no stream.
 *
 * The view is anchored by its BOTTOM edge as a line sequence number
 * (exclusive). In `follow` mode the bottom is always the newest line. Any
 * other mode keeps its anchor while new lines arrive, which is what makes
 * "pause stops the flow" and "new lines below" work: lines past the anchor are
 * counted, not shown.
 *
 * - `follow`: stick to the newest line.
 * - `paused`: `p` froze the view; scrolling keeps it paused.
 * - `scrolled`: the user scrolled up; reaching the bottom resumes follow.
 *
 * An optional `show` predicate (errors only, `e`) narrows the lines. All
 * movement counts VISIBLE lines, and the anchor stays a real sequence number,
 * so toggling the filter keeps the reader near the same place.
 */
export type LogViewMode = "follow" | "paused" | "scrolled";

export interface LogViewState {
  mode: LogViewMode;
  /** Exclusive bottom sequence; ignored in `follow` mode. */
  bottom: number;
}

export const FOLLOW: LogViewState = { mode: "follow", bottom: 0 };

/** The part of the buffer a view needs. `LogBuffer` satisfies it. */
export interface LogSource {
  readonly firstSeq: number;
  readonly nextSeq: number;
  slice(from: number, to: number): LogLine[];
}

export type LineFilter = (line: LogLine) => boolean;

export type LogViewAction =
  | { type: "lineUp" | "lineDown" | "pageUp" | "pageDown" | "top" | "bottom" | "togglePause" }
  | { type: "reset" }
  /** Bring line `seq` into view, roughly centred (search `n`/`N`). */
  | { type: "reveal"; seq: number };

export interface LogWindow {
  lines: LogLine[];
  /** Visible-kind lines held below the window ("new lines below"). */
  below: number;
  /** Visible-kind lines held above the window. */
  above: number;
}

/** Lines that pass the filter, oldest first. At most the buffer's capacity. */
function visibleLines(src: LogSource, show?: LineFilter): LogLine[] {
  const all = src.slice(src.firstSeq, src.nextSeq);
  return show ? all.filter(show) : all;
}

/** Number of lines in `lines` with `seq < bottom` (lines are seq-ordered). */
function countBefore(lines: LogLine[], bottom: number): number {
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid]?.seq ?? Infinity) < bottom) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Index (exclusive) of the window's bottom in `lines`: clamped so the window
 * never runs past the newest line and, when there is enough content, is
 * always full.
 */
function bottomIndex(view: LogViewState, lines: LogLine[], height: number): number {
  if (view.mode === "follow") return lines.length;
  const k = countBefore(lines, view.bottom);
  return Math.min(lines.length, Math.max(Math.min(lines.length, height), k));
}

/** Sequence anchor for a bottom index (exclusive). */
function anchorFor(lines: LogLine[], k: number, src: LogSource): number {
  if (k <= 0) return src.firstSeq;
  const line = lines[k - 1];
  return line ? line.seq + 1 : src.nextSeq;
}

export function logWindow(
  view: LogViewState,
  src: LogSource,
  height: number,
  show?: LineFilter,
): LogWindow {
  const h = Math.max(0, height);
  const lines = visibleLines(src, show);
  const k = bottomIndex(view, lines, h);
  const top = Math.max(0, k - h);
  return {
    lines: h === 0 ? [] : lines.slice(top, k),
    below: lines.length - k,
    above: top,
  };
}

/**
 * Apply a key to the view. `height` is the number of content rows, so a page
 * is a full screen minus one line of overlap (keeps the reader's place).
 */
export function reduceLogView(
  view: LogViewState,
  action: LogViewAction,
  src: LogSource,
  height: number,
  show?: LineFilter,
): LogViewState {
  const h = Math.max(1, height);
  const page = Math.max(1, h - 1);
  const lines = visibleLines(src, show);
  const k = bottomIndex(view, lines, h);
  // Moving keeps a paused view paused; otherwise moving off the bottom is a
  // scroll, and landing on it again resumes following.
  const moveTo = (target: number): LogViewState => {
    const clamped = Math.min(lines.length, Math.max(Math.min(lines.length, h), target));
    const bottom = anchorFor(lines, clamped, src);
    if (view.mode === "paused") return { mode: "paused", bottom };
    if (clamped >= lines.length) return FOLLOW;
    return { mode: "scrolled", bottom };
  };

  switch (action.type) {
    case "lineUp":
      return moveTo(k - 1);
    case "lineDown":
      return moveTo(k + 1);
    case "pageUp":
      return moveTo(k - page);
    case "pageDown":
      return moveTo(k + page);
    case "top":
      return moveTo(h);
    case "bottom":
      // `G` always means "take me to the live end", even from pause.
      return FOLLOW;
    case "togglePause":
      return view.mode === "paused" ? FOLLOW : { mode: "paused", bottom: anchorFor(lines, k, src) };
    case "reset":
      return FOLLOW;
    case "reveal": {
      const idx = countBefore(lines, action.seq);
      if (lines[idx]?.seq !== action.seq) return view;
      // Already on screen: do not move (the highlight is enough).
      if (idx >= k - h && idx < k) return view;
      // Centre it. A search jump is a deliberate look, so it never resumes
      // following by accident: a follow view becomes `scrolled`.
      const target = idx + 1 + Math.floor((h - 1) / 2);
      const clamped = Math.min(lines.length, Math.max(Math.min(lines.length, h), target));
      const bottom = anchorFor(lines, clamped, src);
      return { mode: view.mode === "paused" ? "paused" : "scrolled", bottom };
    }
  }
}
