/**
 * Truecolor vs 256-colour output (P7-T5).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { colorDepth, fg, rgbTo256 } from "../src/ui/render/palette.ts";

const saved = { ...process.env };
afterEach(() => {
  for (const k of ["PODTUI_COLOR", "COLORTERM", "TERM"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("colorDepth", () => {
  test.each([
    [{ COLORTERM: "truecolor", TERM: "xterm-256color" }, "truecolor"],
    [{ COLORTERM: "24bit" }, "truecolor"],
    [{ TERM: "tmux-256color" }, "256"],
    [{ TERM: "screen-256color" }, "256"],
    [{}, "truecolor"], // CI, unknown terminals: unchanged behaviour
    [{ TERM: "tmux-256color", PODTUI_COLOR: "truecolor" }, "truecolor"],
    [{ COLORTERM: "truecolor", PODTUI_COLOR: "256" }, "256"],
  ] as const)("%o → %s", (env, depth) => {
    expect(colorDepth(env)).toBe(depth);
  });
});

describe("rgbTo256", () => {
  test.each([
    [0, 0, 0, 16],
    [255, 255, 255, 231],
    [255, 0, 0, 196],
    [0, 255, 0, 46],
    [0, 0, 255, 21],
    [128, 128, 128, 244], // a grey lands on the grey ramp, not the cube
    [8, 8, 8, 232],
    [122, 162, 247, 111], // tokyo-night accent
  ])("rgb(%i,%i,%i) → %i", (r, g, b, idx) => {
    expect(rgbTo256(r, g, b)).toBe(idx);
  });
});

describe("fg follows the depth", () => {
  test("256 → 38;5;N, truecolor → 38;2;r;g;b", () => {
    delete process.env["NO_COLOR"];
    process.env["PODTUI_COLOR"] = "256";
    expect(fg("#ff0000")).toBe("\u001B[38;5;196m");
    process.env["PODTUI_COLOR"] = "truecolor";
    expect(fg("#ff0000")).toBe("\u001B[38;2;255;0;0m");
  });
});
