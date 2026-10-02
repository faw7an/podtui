import type { ColumnDef } from "./types";

export interface ColumnLayout {
  id: ColumnDef["id"];
  /** Starting x offset, relative to the panel's inner content area. */
  x: number;
  /** Total width including the trailing gap. */
  w: number;
  /** Usable text cells, i.e. `w - gap`. */
  cellW: number;
  /** Blank cells reserved after this column (0 for the last one). */
  gap: number;
}

export interface ColumnResult {
  /** Widths sum to exactly `available`. */
  columns: ColumnLayout[];
  /** Ids dropped to make the row fit, lowest priority first. */
  dropped: ColumnDef["id"][];
}

/** Blank cells between columns (LAYOUT_SPEC §6 says 1-2 spaces). */
export const DEFAULT_COLUMN_GAP = 1;

/**
 * Allocate widths for one row of columns inside `available` cells.
 *
 * Guarantees, when the result is non-null:
 *   - `columns[].cellW` is always >= the requested `minW` (never squeezed)
 *   - `columns[].w` (text + trailing gap) sums to exactly `available`
 *   - columns are ordered as given, with contiguous x offsets
 *
 * When a column cannot be honoured it is dropped, lowest `priority` first.
 * Columns with equal priority are dropped right-to-left, so the leading
 * identity column (name) survives longest.
 */
export function computeColumns(
  available: number,
  specs: readonly ColumnDef[],
): ColumnResult | null {
  if (specs.length === 0) return null;
  if (available <= 0) return null;

  const kept = specs.map((spec, index) => ({ spec, index }));
  const dropped: ColumnDef["id"][] = [];

  // Drop lowest priority first (ties: rightmost first).
  kept.sort((a, b) => {
    const pa = a.spec.priority ?? 0;
    const pb = b.spec.priority ?? 0;
    if (pa !== pb) return pa - pb;
    return b.index - a.index;
  });

  const gapFor = (i: number): number => (i === kept.length - 1 ? 0 : (kept[i]?.spec.gap ?? DEFAULT_COLUMN_GAP));

  /** Minimum total width, gaps included. */
  const minTotal = (list: typeof kept): number =>
    list.reduce((sum, k, i) => sum + k.spec.minW + (i === list.length - 1 ? 0 : (k.spec.gap ?? DEFAULT_COLUMN_GAP)), 0);

  while (kept.length > 0 && minTotal(kept) > available) {
    const victim = kept.shift();
    if (victim) dropped.push(victim.spec.id);
  }
  if (kept.length === 0) return null;

  kept.sort((a, b) => a.index - b.index);

  const gapsTotal = kept.reduce((sum, _k, i) => sum + gapFor(i), 0);
  const usable = available - gapsTotal;
  const cellW = kept.map(({ spec }) => spec.minW);
  let slack = usable - cellW.reduce((a, b) => a + b, 0);

  // 1. Flexible columns share the slack by their `flex` weight.
  const flexIdx = kept
    .map((k, i) => ({ i, flex: k.spec.flex ?? 0 }))
    .filter((k) => k.flex > 0);

  if (flexIdx.length > 0 && slack > 0) {
    const totalFlex = flexIdx.reduce((sum, k) => sum + k.flex, 0);
    for (const { i, flex } of flexIdx) {
      const share = Math.floor((slack * flex) / totalFlex);
      cellW[i] = (cellW[i] ?? 0) + share;
      slack -= share;
    }
  }

  // 2. Any rounding remainder goes to the first flexible column.
  if (slack > 0 && flexIdx.length > 0) {
    const first = flexIdx[0];
    if (first) {
      cellW[first.i] = (cellW[first.i] ?? 0) + slack;
      slack = 0;
    }
  }

  // 3. With no flexible column, hand the remainder to the widest column so
  //    the row still fills the space exactly.
  if (slack > 0) {
    let widest = 0;
    for (let i = 1; i < cellW.length; i++) {
      if ((cellW[i] ?? 0) > (cellW[widest] ?? 0)) widest = i;
    }
    cellW[widest] = (cellW[widest] ?? 0) + slack;
  }

  const columns: ColumnLayout[] = [];
  let x = 0;
  kept.forEach(({ spec }, i) => {
    const gap = gapFor(i);
    const cw = cellW[i] ?? 0;
    columns.push({ id: spec.id, x, w: cw + gap, cellW: cw, gap });
    x += cw + gap;
  });

  return { columns, dropped };
}
