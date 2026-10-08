import type { LogLine } from "../../util/logBuffer.ts";
import { sanitizeLogText } from "../../util/logText.ts";
import type { LineFilter, LogSource } from "./logView.ts";

/**
 * Logs tab search (P3-T4). Pure.
 *
 * Literal, case-insensitive substring over the text the user sees (container
 * ANSI stripped), so what is highlighted is exactly what matched. `n`/`N`
 * step through matching LINES in buffer order and wrap around, like `less`.
 */

export interface LogSearchState {
  /** The input line is open and capturing keys. */
  typing: boolean;
  query: string;
  /** Sequence of the line `n`/`N` last landed on, if any. */
  current: number | null;
}

export const NO_SEARCH: LogSearchState = { typing: false, query: "", current: null };

export function lineMatches(line: LogLine, query: string): boolean {
  if (query === "") return false;
  return sanitizeLogText(line.text).toLowerCase().includes(query.toLowerCase());
}

/** Code-unit ranges `[start, end)` of every match in `text`, non-overlapping. */
export function matchRanges(text: string, query: string): [number, number][] {
  if (query === "") return [];
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  const out: [number, number][] = [];
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    out.push([i, i + needle.length]);
    from = i + needle.length;
  }
  return out;
}

function matching(src: LogSource, query: string, show?: LineFilter): LogLine[] {
  return src
    .slice(src.firstSeq, src.nextSeq)
    .filter((l) => (!show || show(l)) && lineMatches(l, query));
}

/**
 * The next (`dir` 1) or previous (-1) matching line relative to `fromSeq`,
 * wrapping. `fromSeq` null starts from the newest end (`n` finds the latest
 * match first, because the newest lines are what the user is looking at).
 */
export function findMatch(
  src: LogSource,
  query: string,
  fromSeq: number | null,
  dir: 1 | -1,
  show?: LineFilter,
): number | null {
  const hits = matching(src, query, show);
  if (hits.length === 0) return null;
  if (fromSeq === null) return hits.at(-1)?.seq ?? null;
  if (dir === 1) return (hits.find((l) => l.seq > fromSeq) ?? hits[0])?.seq ?? null;
  return ([...hits].reverse().find((l) => l.seq < fromSeq) ?? hits.at(-1))?.seq ?? null;
}

/** `{ total, index }` where `index` is the 1-based position of `current`. */
export function matchCount(
  src: LogSource,
  query: string,
  current: number | null,
  show?: LineFilter,
): { total: number; index: number | null } {
  const hits = matching(src, query, show);
  const at = current === null ? -1 : hits.findIndex((l) => l.seq === current);
  return { total: hits.length, index: at >= 0 ? at + 1 : null };
}
