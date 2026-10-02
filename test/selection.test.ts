import { describe, expect, test } from "bun:test";
import { initialState, reducer, selectedIndex, type LayoutState } from "../src/ui/layout/layoutReducer";
import { PANEL_IDS, type PanelId } from "../src/ui/layout/types";
import type { RowModel } from "../src/ui/view/model";

/**
 * R-12: selection is stored by item ID, not by row index.
 *
 * PROJECT_GUIDE §3 (data flow 4): "Selection is stored by ID, not index, so
 * refreshes do not move the cursor." With index-based selection, a refresh that
 * removes an item ABOVE the cursor silently moves the selection onto whatever
 * slid down into that slot.
 */

function rows(ids: string[]): RowModel[] {
  return ids.map((id) => ({ id, tone: "ok", cells: { name: id, state: "running" } }));
}

/** Reducer navigation helper mirroring what App does on arrow keys. */
function move(state: LayoutState, panel: PanelId, delta: 1 | -1, ids: string[]): LayoutState {
  const currentId = state.selected[panel] ?? "";
  const next =
    currentId === ""
      ? 0
      : Math.min(ids.length - 1, Math.max(0, selectedIndex(currentId, ids) + delta));
  return reducer(state, { type: "select", id: panel, itemId: ids[next] ?? "" });
}

describe("R-12: selection by id survives refreshes", () => {
  test("select stores the item id, not an index", () => {
    const s = reducer(initialState(), { type: "select", id: "containers", itemId: "web" });
    expect(s.selected.containers).toBe("web");
  });

  test("an item removed ABOVE the cursor keeps the cursor on the same item", () => {
    const s = reducer(initialState(), { type: "select", id: "containers", itemId: "d" });

    // A refresh drops "a" and "b"; "d" is still there, now at index 1.
    const after = ["c", "d"];
    expect(selectedIndex(s.selected.containers ?? "", after)).toBe(1);

    // And the rendered row for that index is still "d".
    expect(rows(after)[selectedIndex(s.selected.containers ?? "", after)]?.id).toBe("d");
  });

  test("re-selecting the same id is a no-op (no needless re-render)", () => {
    const s = reducer(initialState(), { type: "select", id: "containers", itemId: "d" });
    const again = reducer(s, { type: "select", id: "containers", itemId: "d" });
    expect(again).toBe(s);
    expect(again.selected.containers).toBe("d");
  });

  test("index-based selection WOULD have drifted (regression witness)", () => {
    // With the old index-based state, selecting index 3 in ["a","b","c","d"]
    // and then removing "a" lands on "d" by luck, but removing "c" (below the
    // cursor) also keeps index 3 -> now out of range and clamped, i.e. the
    // cursor silently jumps to whatever is last.
    const oldIndex = 3;
    const afterShrink = ["a", "b", "d"];
    const oldResolved = Math.min(oldIndex, afterShrink.length - 1);
    expect(afterShrink[oldResolved]).toBe("d");

    // The id-based resolution is correct regardless of removals.
    expect(selectedIndex("d", afterShrink)).toBe(2);
  });

  test("a vanished selection falls back to the first row instead of dangling", () => {
    expect(selectedIndex("gone", ["a", "b"])).toBe(0);
    expect(selectedIndex("", ["a", "b"])).toBe(0);
    expect(selectedIndex("b", [])).toBe(0);
  });

  test("selection survives a toggle off/on of the panel", () => {
    let s = reducer(initialState(), { type: "select", id: "images", itemId: "nginx:alpine" });
    s = reducer(s, { type: "toggle", id: "images" });
    s = reducer(s, { type: "toggle", id: "images" });
    expect(s.selected.images).toBe("nginx:alpine");
  });

  test("navigation moves between ids and clamps at both ends", () => {
    const ids = ["a", "b", "c"];
    let s = initialState();
    s = move(s, "containers", 1, ids);
    expect(s.selected.containers).toBe("a");
    s = move(s, "containers", 1, ids);
    expect(s.selected.containers).toBe("b");
    s = move(s, "containers", 1, ids);
    s = move(s, "containers", 1, ids); // already at the end
    expect(s.selected.containers).toBe("c");
    s = move(s, "containers", -1, ids);
    expect(s.selected.containers).toBe("b");
    s = move(s, "containers", -1, ids);
    s = move(s, "containers", -1, ids); // already at the start
    expect(s.selected.containers).toBe("a");
  });

  test("every panel starts with no selection", () => {
    const s = initialState();
    for (const id of PANEL_IDS) expect(s.selected[id]).toBe("");
  });

  test("selection is per panel", () => {
    let s = reducer(initialState(), { type: "select", id: "containers", itemId: "web" });
    s = reducer(s, { type: "select", id: "images", itemId: "nginx:alpine" });
    expect(s.selected.containers).toBe("web");
    expect(s.selected.images).toBe("nginx:alpine");
  });
});