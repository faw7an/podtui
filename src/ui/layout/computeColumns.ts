import type { ColumnDef } from "./types";

export interface ColumnLayout {
  id: ColumnDef["id"];
  /** Starting x offset, relative to the panel's inner content area. */
  x: number;
  w: number;
}

export interface ColumnResult {
  /** Widths sum to exactly `available`. */
  columns: ColumnLayout[];
  /** Ids dropped to make the row fit, lowest priority first. */
  dropped: ColumnDef["id"][];
}

/**
 * Allocate widths for one row of columns inside `available` cells.
 *
 * Guarantees, when the result is non-null:
 *   - `columns[].w` is always >= the requested `minW` (never squeezed)
 *   - widths sum to exactly `available` (no leftover gap, no overflow)
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

  const minTotal = (list: typeof kept): number =>
    list.reduce((sum, { spec }) => sum + spec.minW, 0);

  while (kept.length > 0 && minTotal(kept) > available) {
    const victim = kept.shift();
    if (victim) dropped.push(victim.spec.id);
  }
  if (kept.length === 0) return null;

  kept.sort((a, b) => a.index - b.index);

  const widths = kept.map(({ spec }) => spec.minW);
  let slack = available - minTotal(kept);

  // 1. Flexible columns share the slack by their `flex` weight.
  const flexIdx = kept
    .map((k, i) => ({ i, flex: k.spec.flex ?? 0 }))
    .filter((k) => k.flex > 0);

  if (flexIdx.length > 0 && slack > 0) {
    const totalFlex = flexIdx.reduce((sum, k) => sum + k.flex, 0);
    for (const { i, flex } of flexIdx) {
      const share = Math.floor((slack * flex) / totalFlex);
      widths[i] = (widths[i] ?? 0) + share;
      slack -= share;
    }
  }

  // 2. Any rounding remainder goes to the first flexible column.
  if (slack > 0 && flexIdx.length > 0) {
    const first = flexIdx[0];
    if (first) {
      widths[first.i] = (widths[first.i] ?? 0) + slack;
      slack = 0;
    }
  }

  // 3. With no flexible column, hand the remainder to the widest column so
  //    the row still fills the space exactly.
  if (slack > 0) {
    let widest = 0;
    for (let i = 1; i < widths.length; i++) {
      if ((widths[i] ?? 0) > (widths[widest] ?? 0)) widest = i;
    }
    widths[widest] = (widths[widest] ?? 0) + slack;
  }

  const columns: ColumnLayout[] = [];
  let x = 0;
  kept.forEach(({ spec }, i) => {
    const w = widths[i] ?? 0;
    columns.push({ id: spec.id, x, w });
    x += w;
  });

  return { columns, dropped };
}
