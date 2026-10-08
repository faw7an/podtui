import type { LogLine } from "../../util/logBuffer.ts";

/**
 * Where the Logs tab is looking (P3-T2). Pure: no Ink, no stream.
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

export type LogViewAction =
  | { type: "lineUp" | "lineDown" | "pageUp" | "pageDown" | "top" | "bottom" | "togglePause" }
  | { type: "reset" };

export interface LogWindow {
  lines: LogLine[];
  /** Lines held below the window ("new lines below" when not following). */
  below: number;
  /** Lines held above the window. */
  above: number;
}

/**
 * Bottom edge actually shown: clamped so the window never runs past the
 * newest line and, when there is enough content, is always full.
 */
function effectiveBottom(view: LogViewState, src: LogSource, height: number): number {
  if (view.mode === "follow") return src.nextSeq;
  const minBottom = Math.min(src.nextSeq, src.firstSeq + Math.max(0, height));
  return Math.min(src.nextSeq, Math.max(minBottom, view.bottom));
}

export function logWindow(view: LogViewState, src: LogSource, height: number): LogWindow {
  const h = Math.max(0, height);
  const bottom = effectiveBottom(view, src, h);
  const top = Math.max(src.firstSeq, bottom - h);
  return {
    lines: h === 0 ? [] : src.slice(top, bottom),
    below: src.nextSeq - bottom,
    above: top - src.firstSeq,
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
): LogViewState {
  const h = Math.max(1, height);
  const page = Math.max(1, h - 1);
  const bottom = effectiveBottom(view, src, h);
  // Moving keeps a paused view paused; otherwise moving off the bottom is a
  // scroll, and landing on it again resumes following.
  const moveTo = (target: number): LogViewState => {
    const clamped = effectiveBottom({ mode: "scrolled", bottom: target }, src, h);
    if (view.mode === "paused") return { mode: "paused", bottom: clamped };
    if (clamped >= src.nextSeq) return FOLLOW;
    return { mode: "scrolled", bottom: clamped };
  };

  switch (action.type) {
    case "lineUp":
      return moveTo(bottom - 1);
    case "lineDown":
      return moveTo(bottom + 1);
    case "pageUp":
      return moveTo(bottom - page);
    case "pageDown":
      return moveTo(bottom + page);
    case "top":
      return moveTo(src.firstSeq + h);
    case "bottom":
      // `G` always means "take me to the live end", even from pause.
      return FOLLOW;
    case "togglePause":
      return view.mode === "paused" ? FOLLOW : { mode: "paused", bottom };
    case "reset":
      return FOLLOW;
  }
}
