import { fit, sliceCells, truncate } from "../../util/fit.ts";
import { visibleWidth } from "./palette.ts";

/**
 * A pre-composed character grid for the whole frame.
 *
 * Why a line buffer instead of nested Ink boxes: Ink does **not** clip — text
 * that is too wide wraps and extra rows appear (verified, docs/DECISIONS.md).
 * With nested boxes we would be trusting Ink's measurement of every nested
 * child. With a buffer we own every cell, so LAYOUT_SPEC §9 invariants 3 and 4
 * (exact widths, exact line count) are provable in a unit test with no terminal.
 *
 * Writes are segment-based: each write records `{x, y, text}` and composition
 * pads the gaps. Segments are truncated so a line can never exceed `cols`.
 */

interface Segment {
  x: number;
  y: number;
  text: string;
}

export class LineBuffer {
  readonly cols: number;
  readonly rows: number;
  private readonly segments: Segment[] = [];

  constructor(cols: number, rows: number) {
    this.cols = Math.max(0, Math.floor(cols));
    this.rows = Math.max(0, Math.floor(rows));
  }

  /**
   * Place `text` at (x, y). Returns the visible width actually written, which
   * is what the caller needs to position the next segment.
   *
   * Note: this *truncates* but never pads. Padding here would make a segment
   * claim the whole remaining row and silently drop the segments after it.
   */
  write(x: number, y: number, text: string): number {
    if (y < 0 || y >= this.rows || x < 0 || x >= this.cols) return 0;
    if (text.length === 0) return 0;
    const clipped = truncate(text, this.cols - x);
    const width = visibleWidth(clipped);
    if (width <= 0) return 0;
    this.segments.push({ x, y, text: clipped });
    return width;
  }

  /** Compose a single row into a string of exactly `cols` visible cells. */
  private composeRow(y: number): string {
    const row = this.segments.filter((s) => s.y === y).sort((a, b) => a.x - b.x);
    let out = "";
    let cursor = 0;
    for (const seg of row) {
      if (seg.x < cursor) continue; // never re-write an occupied cell
      if (seg.x > cursor) {
        out += " ".repeat(Math.min(seg.x - cursor, this.cols - cursor));
        cursor = seg.x;
      }
      const clipped = truncate(seg.text, this.cols - cursor);
      const width = visibleWidth(clipped);
      if (width <= 0) continue;
      out += clipped;
      cursor += width;
    }
    return out + " ".repeat(Math.max(0, this.cols - cursor));
  }

  /** Exactly `rows` lines, each exactly `cols` visible cells. */
  toLines(): string[] {
    const lines: string[] = [];
    for (let y = 0; y < this.rows; y++) lines.push(this.composeRow(y));
    return lines;
  }

  /** Raw segments, exposed for tests that assert placement. */
  entries(): readonly Segment[] {
    return this.segments;
  }

  /**
   * Clear a cell rectangle so an overlay can be drawn there. Composition keeps
   * the leftmost segment (`composeRow` never re-writes an occupied cell), so
   * an overlay written last would lose every cell — excising first hands the
   * rectangle to the overlay while the stubs outside it survive, escapes
   * intact via `sliceCells`.
   */
  excise(x: number, y: number, w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    const kept: Segment[] = [];
    for (const seg of this.segments) {
      if (seg.y < y || seg.y >= y + h) {
        kept.push(seg);
        continue;
      }
      const left = sliceCells(seg.text, 0, x - seg.x);
      const right = sliceCells(seg.text, x + w - seg.x);
      if (visibleWidth(left) > 0) kept.push({ x: seg.x, y: seg.y, text: left });
      // Right part starts at the cut. A wide glyph straddling the boundary is
      // dropped by sliceCells, so the stub can sit up to one cell early — the
      // gap pads with a space and the popup covers the rect itself anyway.
      if (visibleWidth(right) > 0) {
        kept.push({ x: Math.max(seg.x, x + w), y: seg.y, text: right });
      }
    }
    this.segments.length = 0;
    this.segments.push(...kept);
  }
}

/**
 * Compose a single line from left-to-right parts, each already exactly its
 * declared width. Used by the region builders, which return whole lines rather
 * than individual segments.
 */
export function composeInline(parts: readonly string[], cols: number): string {
  let out = "";
  for (const part of parts) {
    const room = cols - visibleWidth(out);
    if (room <= 0) break;
    out += fit(part, room);
  }
  return out + " ".repeat(Math.max(0, cols - visibleWidth(out)));
}
