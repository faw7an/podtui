/**
 * Empty panels hide and come back by themselves; numbers never change.
 */

import { describe, expect, test } from "bun:test";
import { initialState, reducer, shownPanels, visibleOrder } from "../src/ui/layout/layoutReducer.ts";

describe("setAutoHidden", () => {
  test("hidden panels leave the shown set but not the user's own visible set", () => {
    const s = reducer(initialState(), { type: "setAutoHidden", ids: ["quadlets", "pods"] });
    expect([...shownPanels(s)]).toEqual(["containers", "images", "volumes", "networks"]);
    expect(s.visible.has("quadlets")).toBe(true);
    const back = reducer(s, { type: "setAutoHidden", ids: ["pods"] });
    expect(shownPanels(back).has("quadlets")).toBe(true);
  });

  test("focus and zoom move off a panel that just went away", () => {
    let s = reducer(initialState(), { type: "activate", id: "quadlets" });
    s = reducer(s, { type: "zoom" });
    s = reducer(s, { type: "setAutoHidden", ids: ["quadlets"] });
    expect(s.focus).not.toBe("quadlets");
    expect(s.zoom).toBeNull();
  });

  test("Tab skips hidden panels", () => {
    let s = reducer(initialState(), { type: "setAutoHidden", ids: ["images", "volumes"] });
    s = reducer(s, { type: "focus", id: "containers" });
    s = reducer(s, { type: "move", dir: 1 });
    expect(s.focus).toBe("networks");
    expect(visibleOrder(s)).not.toContain("images");
  });

  test("the same set again is a no-op (no re-render)", () => {
    const s = reducer(initialState(), { type: "setAutoHidden", ids: ["pods"] });
    expect(reducer(s, { type: "setAutoHidden", ids: ["pods"] })).toBe(s);
  });
});
