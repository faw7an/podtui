import { describe, expect, test } from "bun:test";
import { appRenderOptions } from "../src/ui/renderOptions.ts";

/**
 * The app must be interactive whenever stdout is a terminal, even with `CI`
 * set: Ink's own default turns CI into non-interactive mode, which writes
 * only the final frame at exit (a blank screen until quit).
 */
describe("appRenderOptions", () => {
  test("a terminal stdout is interactive, with the alternate screen", () => {
    expect(appRenderOptions({ isTTY: true })).toEqual({ alternateScreen: true, interactive: true });
  });

  test("the decision ignores CI detection", () => {
    const saved = process.env["CI"];
    process.env["CI"] = "true";
    try {
      expect(appRenderOptions({ isTTY: true }).interactive).toBe(true);
    } finally {
      if (saved === undefined) delete process.env["CI"];
      else process.env["CI"] = saved;
    }
  });

  test("a non-terminal stdout is not interactive", () => {
    expect(appRenderOptions({ isTTY: false }).interactive).toBe(false);
    expect(appRenderOptions({}).interactive).toBe(false);
  });
});
