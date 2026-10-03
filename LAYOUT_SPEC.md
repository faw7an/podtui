# LAYOUT_SPEC — responsive, btop-style layout for `podtui`

Applies to: Phase 2 rework (UI shell). Read `AGENTS.md` first. Anything marked ⚠️ VERIFY must be checked against the installed Ink version / real terminal before you rely on it.

---

## 1. Problems observed (from screenshots)

| # | Symptom | Likely cause (confirm by reading the code and reproducing) |
|---|---|---|
| 1 | Column headers render vertically (`S T A T U S` stacked), rows like `runrunrunrunning` | Columns have ~1–2 character widths, so text wraps instead of truncating; or cells are rendered several times |
| 2 | Panel titles/rows collide (`[2] Co6 tainer items`) | Title, count and header texts share a line without width budgeting |
| 3 | On narrow widths the detail pane draws **over** the list panels and the tab pills overlap | Detail/tabs positioned or sized independently of the available width; no breakpoints |
| 4 | On tall/large screens content below is cut off | Root height not bound to terminal rows; lists not windowed; each panel renders more lines than its box height |
| 5 | Tab bar is 3 rows tall, and the selected tab's label is missing | Bordered "pill" boxes with width computed wrongly; selected state overwrites the text |

Do not guess the cause: reproduce first (section 8), then fix at the root. The remedy below is architectural, not a patch.

## 2. Core principle: layout is computed, not negotiated

Do **not** rely on flexbox auto-sizing or Ink's text wrapping for the main frame. Instead:

1. Read terminal `cols × rows` (re-read on resize).
2. A **pure function** `computeLayout(input) → LayoutResult` returns an explicit rectangle `{x, y, w, h}` for every region.
3. Components receive concrete numeric `width` and `height` and **must** render within them.
4. Every line of text is produced by a pure `fit(text, width)` helper that truncates with `…` and pads to exactly `width` cells. No text is ever allowed to wrap.
5. Lists are **windowed**: they render only `innerHeight − headerRows` rows, with the selected row always visible.

This makes overlap and cut-off impossible by construction, and makes the whole thing unit-testable without a terminal.

### Width of characters
Use a display-width function (not `string.length`) for truncation/padding, so wide characters (CJK, some emoji) and combining marks do not break alignment. ⚠️ VERIFY what Ink/Bun offer (`Bun.stringWidth`, or Ink's dependencies such as `string-width`) in the installed versions; use one, add a unit test. ANSI color codes must not count toward width.

## 3. Screen anatomy

```
row 0   ▲ podtui   1 Pods  2 Containers  3 Images  4 Volumes  5 Networks  6 Quadlets          9:40 PM   ← header (1 row)
rows 1…  ┌ body: panel area + detail area (computed) ┐
last    1-6 toggle · Tab focus · ↑↓ nav · Enter inspect · z zoom · ? help · q quit           ← footer (1 row)
```

- Header and footer are **exactly 1 row each**. Body height = `rows − 2`.
- **Tab bar = the header row.** No bordered pills. Each tab is `N label`:
  - visible panel: number in accent color + bold label
  - focused panel: inverse/underlined
  - hidden panel: dim, with a `·` or strikethrough-like dim style (never remove it, so the user can toggle it back)
  - narrow widths: shorten labels (`2 Cont`), then numbers only (`1 2 3 4 5 6`).
  - If even numbers-only does not fit, drop the title and clock first.
- **Status lives in the chrome rows; there is no third chrome row.** P2-T2's
  "status bar" is the header-right clock (data freshness: the last successful
  refresh time) plus the footer-right error slot (latest engine error),
  alongside the tab visibility/focus states. A dedicated status row would
  shrink the body for information that already has a home — at 40×10 every
  row counts, and header/footer are exactly 1 row each by the rule above.
- Root container has `width = cols`, `height = rows` (⚠️ VERIFY whether `rows − 1` avoids Ink's scroll/flicker when output height equals terminal height; record in DECISIONS.md).
- Use the terminal **alternate screen buffer** so the app does not pollute scrollback and restores the screen on exit (⚠️ VERIFY how to combine with Ink; ensure it is restored on every exit path per FR-10).

## 4. btop-style toggling

- Keys `1`–`6` toggle the corresponding panel **off/on**.
- When a panel is toggled off it disappears **and the remaining panels expand to use the freed space** (recomputed by `computeLayout`). Toggling on shrinks the others back.
- The detail pane is always present when there is room; it also expands when list panels are hidden. If **all** list panels are hidden the detail pane takes the full body (at least one of {list panel, detail} is always visible; refuse hiding the last list panel when no item is selected).
- Focus follows visibility: if the focused panel is hidden, focus moves to the nearest visible one. Selection is remembered per panel and restored when the panel returns.
- Hidden panels do not poll or stream (FR-3).
- `z` toggles **zoom** on the focused panel (it fills the whole body; press again to restore). `Enter` on a list item focuses the detail pane; `Esc` goes back.
- Layout state (visible set, focus, zoom) lives in one reducer so it is testable.

## 5. Responsive breakpoints

Let `n` = number of visible list panels, `body = {w: cols, h: rows − 2}`.

| Mode | Condition | Arrangement |
|---|---|---|
| **XL** | `cols ≥ 150` | List area (≈ 55 % of width) arranged as a **2-column grid** of panels (btop-like), detail on the right (≈ 45 %) |
| **L** | `110 ≤ cols < 150` | List area one column (stack, ≈ 45 % width, min 40), detail on the right |
| **M** | `70 ≤ cols < 110` | Lists stacked in the top ≈ 50 % of the body, detail below (full width) |
| **S** | `cols < 70` | **Single-region mode**: only the focused list panel is shown (full body). `Enter` opens detail full-screen, `Esc` returns. Number keys switch focus to that panel (toggle semantics still apply to the set) |
| **Too small** | `cols < 40` or `rows < 10` | Replace everything with a centered message: `Terminal too small (need ≥ 40×10, have 32×8)`. No crash, no partial draw |

Make the thresholds named constants in one file so they can be tuned; the numbers above are starting points, not facts.

> **Resolved 2026-10-02 — the table above is normative and implemented.** An
> earlier implementation used `L ≥ 120`, `M ≥ 100`, `S ≥ 40`, which put 80×24 in
> mode S. That drift was reverted; the constants now live in
> `src/ui/layout/constants.ts` and are asserted by `test/layout.test.ts`. Do not
> change them without changing this table.

### Vertical fitting (the "cut off" fix)
Within a column of panels:
1. Each visible panel needs `MIN_PANEL_H = 4` — 2 rows of border plus at least 1 data row. (The starting value of 6 assumed a column header; see the short-panel rule in §6, which now removes the header instead of shrinking the box.)
2. Distribute available height by **weights** (focused = 1.5, others = 1.0), integer rounding, remainder given to the focused panel. Sum of heights must equal the available height exactly.
3. If `n × MIN_PANEL_H > available height`, apply **accordion**: non-focused panels collapse to a **1-row title strip** (`▸ 3 Images (2)`, no border) and the focused panel gets the rest. If still not enough, omit the lowest-priority panels entirely, then show only the focused panel (mode S behavior).
4. Never produce a rect with `h ≤ 0` or outside the body.

**Growth is content-driven.** Each panel declares a desired height of
`PANEL_CHROME_H + itemCount`. Panels grow toward that cap by weight; once every
panel has reached its cap, the remaining surplus goes to the focused panel, so a
column always tiles exactly and a long list never hides rows behind a short one.
A panel is never grown past its cap unless it is the focused one.

**The focused panel is never collapsed.** Its minimum is `MIN_PANEL_H`; accordion
only ever collapses non-focused panels. If the focused panel still cannot reach
`MIN_PANEL_H`, lower-priority panels are dropped instead of collapsing focus.

Horizontal fitting in the grid (XL): if a grid column would be narrower than `MIN_PANEL_W = 30`, fall back to mode L.

### Focus never changes due to size
Resize, breakpoint changes and any recomputation must leave the focus and the
per-panel selection untouched. Focus moves **only** for explicit user actions:
hiding the focused panel, focusing another visible panel, opening or closing
detail, `Tab`/arrow navigation. Focusing a panel that would be collapsed expands
it and collapses another panel instead.

## 6. Panel anatomy

```
┌[2] Containers 6─────────────────────┐   ← title in the border: [N] name + count; truncate title first
│ NAME            STATUS     AGE      │   ← 1 header row (dim/bold)
│> web            ● running  2h       │   ← selected row: inverse or accent marker
│  web-pod-backend ● running 2h       │
│  failing        ✖ exited(1) 5m      │
│                                      │   ← empty rows are blank-padded, never omitted
└─────────────────────────── ↓ 3 more ┘   ← scroll hint when rows exist off-screen
```

- Inner size = `w − 2`, `h − 2`. Header row consumes 1 of the inner rows.
- **Short-panel rule (normative).** The layout decides this, never the component; `panelMetrics(h)` in `src/ui/layout/panelView.ts` is the single source of truth:

  | panel height | bordered | column header | data rows |
  |---|---|---|---|
  | `h ≥ 6` | yes | yes | `h − 3` |
  | `h = 4–5` | yes | **no** (dropped to gain a row) | `h − 2` |
  | `h < 4` | **no** — collapsed 1-row title strip | no | `0` |

  A bordered box needs 2 rows for its own border and Ink does not clip, so a
  2- or 3-row bordered box would have its border overdraw its content. `collapsed`
  therefore means *borderless strip* and never *short box*.
- **Column layout is a pure function** `computeColumns(innerWidth, spec) → widths[]`:
  - spec per column: `{key, min, max?, flex?, priority}`; `NAME` is the flexible column.
  - If widths do not fit, **drop lowest-priority columns first** (e.g. AGE, then PORTS), never shrink below `min`.
  - Gap between columns = 1–2 spaces. Total exactly = `innerWidth`.
- Every cell goes through `fit()`. Status text always accompanies color (`● running`, `✖ exited(1)`), never color alone.
- Scroll: keep selection visible (`scrollTop` adjusted on selection change/resize). Show `↓ N more` / `↑ N more` in the border when needed, so the hint costs no data row.
- Focused panel: accent border color; others: dim border. Border style from theme.
- **Markers must carry meaning without color** (`NO_COLOR`, 16-color terminals):
  - focused panel's selected row → reverse video **and** a `▸ ` prefix;
  - unfocused panels keep their remembered selection with a dim `▸ ` prefix and **no** reverse video;
  - a collapsed title strip is always `▸ N Label (count)`, bold accent when focused.
  The `▸` prefix is part of the contract and is asserted by tests with color stripped.

## 7. Detail pane

- Own bordered box with a **one-row tab strip inside** the box (`Logs  Stats  Env  Config  Top`, active tab highlighted, truncated/abbreviated when narrow), then content filling the rest.
- Content is windowed exactly like lists (scrollable, scroll hint). Long lines **truncate with `…`** by default; `w` toggles wrapping (wrapping must be done by our own pure function, not by the renderer).
- Title shows the selected item (`web · running`). Placeholder when nothing selected.
- Layout must give the detail pane a minimum of `MIN_DETAIL_W = 40` in modes XL/L; otherwise switch to a smaller mode.

**Detail is available at every size; it is never removed.**
- **XL / L**: detail sits to the right of the list area, `MIN_DETAIL_W = 40`.
- **M**: list band on top (~50% of the body), detail below at full width.
- **S**: only the focused list panel is drawn. `Enter` opens detail **full-screen** (it takes the whole body), `Esc` returns to the list and restores the previous list focus. Number keys keep working on the list view — they focus a panel, or toggle it when it is already focused.

### Escape priority
`Esc` is resolved in this order, and only the first match fires:

1. an open dialog or menu (nothing else happens),
2. leaving detail full-screen or zoom,
3. clearing an active filter/search,
4. nothing.

`resolveEscape(state, ctx)` in `src/ui/layout/layoutReducer.ts` implements this as a pure function so the ordering is testable without rendering a dialog.

## 8. Types and file layout

```ts
// src/ui/layout/types.ts
export type Rect = { x: number; y: number; w: number; h: number };
export type PanelId = 'pods' | 'containers' | 'images' | 'volumes' | 'networks' | 'quadlets';
export type Mode = 'XL' | 'L' | 'M' | 'S' | 'TOO_SMALL';

export type LayoutInput = {
  cols: number; rows: number;
  visible: ReadonlySet<PanelId>;   // toggled-on list panels
  focus: PanelId | 'detail';
  zoom: PanelId | 'detail' | null;
  detailFullscreen: boolean;       // used in mode S
};

export type PanelRect = { id: PanelId; rect: Rect; collapsed: boolean };

export type LayoutResult = {
  mode: Mode;
  header: Rect; footer: Rect; body: Rect;
  panels: PanelRect[];             // visible panels, in display order
  detail: Rect | null;
  message?: string;                // TOO_SMALL text
};
```

Suggested files (adjust to the existing code, but keep pure logic separate from React):
```
src/ui/layout/types.ts
src/ui/layout/constants.ts      breakpoints, MIN sizes, weights
src/ui/layout/computeLayout.ts  pure
src/ui/layout/computeColumns.ts pure
src/ui/layout/layoutReducer.ts  visible/focus/zoom state, pure
src/util/fit.ts                 fit(text,width), padRight, truncate, displayWidth
src/ui/hooks/useTerminalSize.ts cols/rows + resize subscription (⚠️ VERIFY Ink API)
src/ui/components/Header.tsx    tab bar row
src/ui/components/Footer.tsx    key hints row (drops hints by priority when narrow)
src/ui/components/PanelFrame.tsx   border + title + scroll hint, takes Rect
src/ui/components/Table.tsx     windowed rows using computeColumns
```

`PanelFrame` should draw its border from computed `w × h`. ⚠️ VERIFY whether Ink's `<Box borderStyle>` with explicit `width`/`height` is reliable in the installed version; if it misbehaves, render the border manually with box-drawing characters (we control every character, so alignment is guaranteed). Absolute positioning of siblings is **not** used: the body is composed by the layout rects (e.g. a row of Boxes with explicit numeric widths/heights, or a pre-composed line buffer). Pick one approach, record it in DECISIONS.md.

## 9. Invariants (must hold for every terminal size ≥ minimum)

1. Every rect is inside the body; no rect has `w ≤ 0` or `h ≤ 0`.
2. No two rects overlap.
3. In each stacked column, heights sum **exactly** to the column height; in each row, widths sum exactly to the row width (no gaps/overflow).
4. Total rendered output has exactly `rows` lines, each of display width ≤ `cols`. (Never `rows + 1`.)
5. At least one list panel or the detail pane is visible.
6. Hidden panels' number tabs remain visible in the header (unless numbers-only still doesn't fit).
7. The selected row is always inside the rendered window.
8. Toggling a panel off then on restores the previous selection.

## 10. Tests

### Automated (unit, pure)
- `fit`: ASCII, wide chars, ANSI-containing strings, zero/one width, exact width, truncation adds `…`.
- `computeColumns`: sums to innerWidth, drops low-priority columns in order, respects mins, handles innerWidth tiny.
- `computeLayout` **property test**: loop over `cols ∈ [30..320]`, `rows ∈ [8..100]`, and every subset of the 6 panels × every focus/zoom value; assert invariants 1–5 hold or mode is `TOO_SMALL` with a message.
- Specific cases: `120×35` all six visible; `200×50` all six (XL grid); `100×30`; `80×24`; `60×20`; `40×10`; hide panel 2 → others' heights increase and still sum exactly.
- `layoutReducer`: toggle, refuse hiding the last panel, focus relocation, zoom on/off, selection memory.

### Automated (Ink render, `ink-testing-library`; ⚠️ VERIFY it simulates a given `columns`/`rows`, otherwise inject sizes through the `useTerminalSize` hook)
- At each of `200×50`, `120×35`, `100×30`, `80×24`, `60×20`, `40×10`: `lastFrame()` has ≤ `rows` lines and no line longer than `cols` (strip ANSI first); header contains all six numbers; no line contains the vertical-letter pattern (assert the `STATUS` header text appears intact on one line when the status column is shown).
- A list with 100 items in a short panel: selected item visible after moving to the last item; scroll hint present.
- Snapshot files for the sizes above (committed under `test/__snapshots__/layout/`) so regressions show in diffs.

### Manual (the human)
1. Run in the terminal at full screen; drag-resize the window from very large to very small and back: no overlap, no cut-off, no leftover characters, no flicker storms.
2. Press `1`…`6` repeatedly: tabs dim/undim in the header; remaining panels expand/shrink immediately like btop; the last one refuses to hide.
3. `z` on a panel zooms; `z` again restores; selection preserved.
4. Make the terminal ~60 columns wide: single-panel mode works; `Enter` opens detail full-screen; `Esc` returns.
5. Tall terminal (e.g. 60+ rows) with many containers (seed 50 in the sandbox): all rows reachable via scrolling; last row visible.
6. Quit with `q` and Ctrl+C: terminal fully restored (screen, cursor, no mouse garbage).
7. Compare side by side with btop for the "feel" of toggling and expanding.

## 11. Acceptance criteria

- All invariants in section 9 are enforced by tests that pass for the whole size matrix.
- The five problems in section 1 are reproduced first (screenshots or captured frames saved to `docs/screenshots/layout-before/`), then verified gone (`docs/screenshots/layout-after/`) at 200×50, 120×35, 80×24, 60×20.
- `bun run check` passes; no new dependencies without a DECISIONS.md entry.
- No component renders text without going through `fit()` or a width-bounded cell.

## 12. Out of scope for this task
Mouse support, themes beyond using the existing `Theme` object, new data features. Keep the current data hooks and tabs; only replace the frame/layout/rendering approach.
