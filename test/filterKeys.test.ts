import { describe, expect, test } from "bun:test";
import { routeFilterKey } from "../src/input/filterKeys.ts";

/**
 * The popup consumes every key: global bindings are dead while it captures
 * typing. These tests are the proof — no mounted app needed.
 */
describe("routeFilterKey", () => {
  test("q and 1 are typed into the input; they can never quit or toggle", () => {
    expect(routeFilterKey("q", {})).toEqual({ type: "filterInput", text: "q" });
    expect(routeFilterKey("1", {})).toEqual({ type: "filterInput", text: "1" });
    expect(routeFilterKey("?", {})).toEqual({ type: "filterInput", text: "?" });
    expect(routeFilterKey(" ", {})).toEqual({ type: "filterInput", text: " " });
  });

  test("a paste arrives as one input and appends verbatim", () => {
    expect(routeFilterKey("web-pod", {})).toEqual({ type: "filterInput", text: "web-pod" });
  });

  test("Enter applies, Backspace/Delete edit", () => {
    expect(routeFilterKey("", { return: true })).toEqual({ type: "endFilter" });
    expect(routeFilterKey("", { backspace: true })).toEqual({ type: "filterBackspace" });
    expect(routeFilterKey("", { delete: true })).toEqual({ type: "filterBackspace" });
  });

  test("Ctrl+U clears the line", () => {
    expect(routeFilterKey("u", { ctrl: true })).toEqual({ type: "clearFilterLine" });
  });

  test("navigation and paging keys are swallowed, not typed", () => {
    expect(routeFilterKey("", { tab: true })).toBeNull();
    expect(routeFilterKey("", { upArrow: true })).toBeNull();
    expect(routeFilterKey("", { downArrow: true })).toBeNull();
    expect(routeFilterKey("", { leftArrow: true })).toBeNull();
    expect(routeFilterKey("", { rightArrow: true })).toBeNull();
    expect(routeFilterKey("", { pageUp: true })).toBeNull();
    expect(routeFilterKey("", { pageDown: true })).toBeNull();
  });

  test("other Ctrl/Meta combos are swallowed", () => {
    expect(routeFilterKey("a", { ctrl: true })).toBeNull();
    expect(routeFilterKey("b", { meta: true })).toBeNull();
    expect(routeFilterKey("", {})).toBeNull();
  });
});
