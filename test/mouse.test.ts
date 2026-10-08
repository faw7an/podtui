/**
 * Mouse parsing (P7-T6): raw SGR reports per xterm ctlseqs, in both the form
 * Ink hands to useInput (ESC stripped) and the raw form.
 */

import { describe, expect, test } from "bun:test";
import { MOUSE_OFF, MOUSE_ON, enableMouse, looksLikeMouse, parseMouse } from "../src/input/mouse.ts";

const none = { shift: false, meta: false, ctrl: false };

describe("parseMouse", () => {
  test.each([
    ["[<0;10;5M", { kind: "press", button: "left", x: 9, y: 4, ...none }],
    ["[<0;10;5m", { kind: "release", button: "left", x: 9, y: 4, ...none }],
    ["[<1;1;1M", { kind: "press", button: "middle", x: 0, y: 0, ...none }],
    ["[<2;3;4M", { kind: "press", button: "right", x: 2, y: 3, ...none }],
    ["[<64;3;4M", { kind: "wheel", direction: "up", x: 2, y: 3, ...none }],
    ["[<65;3;4M", { kind: "wheel", direction: "down", x: 2, y: 3, ...none }],
    ["[<32;7;8M", { kind: "motion", button: "left", x: 6, y: 7, ...none }],
    ["[<4;2;2M", { kind: "press", button: "left", x: 1, y: 1, shift: true, meta: false, ctrl: false }],
    ["[<16;2;2M", { kind: "press", button: "left", x: 1, y: 1, shift: false, meta: false, ctrl: true }],
    ["[<89;2;2M", { kind: "wheel", direction: "down", x: 1, y: 1, shift: false, meta: true, ctrl: true }],
    ["\u001B[<0;200;60M", { kind: "press", button: "left", x: 199, y: 59, ...none }],
  ] as const)("%p", (input, event) => {
    expect(parseMouse(input)).toEqual(event as never);
  });

  test.each(["j", "[", "[<0;10M", "[<0;0;5M", "[<66;1;1M", "[<a;1;1M", "[A"])("not a usable report: %p", (input) => {
    expect(parseMouse(input)).toBeNull();
  });

  test("looksLikeMouse catches malformed reports so they never become typing", () => {
    expect(looksLikeMouse("[<0;10M")).toBe(true);
    expect(looksLikeMouse("[")).toBe(false);
    expect(looksLikeMouse("[A")).toBe(false);
  });
});

describe("enableMouse", () => {
  test("writes the enable sequence, and the disable once (idempotent)", () => {
    const written: string[] = [];
    const disable = enableMouse({ write: (s: string) => written.push(s) });
    expect(written).toEqual([MOUSE_ON]);
    disable();
    disable();
    expect(written).toEqual([MOUSE_ON, MOUSE_OFF]);
  });

  test("the sequences are exactly modes 1000 and 1006", () => {
    expect(MOUSE_ON).toBe("\u001B[?1000h\u001B[?1006h");
    expect(MOUSE_OFF).toBe("\u001B[?1006l\u001B[?1000l");
  });
});

describe("signals turn reporting off (found live: SIGTERM left it on)", () => {
  test("SIGTERM in a real child process writes MOUSE_OFF and exits 143", async () => {
    const proc = Bun.spawn(
      ["bun", "-e", 'import { enableMouse } from "./src/input/mouse.ts"; enableMouse(process.stdout); setInterval(() => {}, 1000);'],
      { stdout: "pipe", stderr: "ignore" },
    );
    const chunks: string[] = [];
    const reader = (async () => {
      const dec = new TextDecoder();
      const r = proc.stdout.getReader();
      for (;;) {
        const { done, value } = await r.read();
        if (done) break;
        chunks.push(dec.decode(value));
      }
    })();
    for (let i = 0; i < 100 && !chunks.join("").includes(MOUSE_ON); i++) await Bun.sleep(20);
    proc.kill("SIGTERM");
    const code = await proc.exited;
    await reader;
    const out = chunks.join("");
    expect(out.indexOf(MOUSE_OFF)).toBeGreaterThan(out.indexOf(MOUSE_ON));
    expect(code).toBe(143);
  }, 15000);
});

test("an uncaught exception still turns reporting off", async () => {
  const proc = Bun.spawn(
    ["bun", "-e", 'import { enableMouse } from "./src/input/mouse.ts"; enableMouse(process.stdout); setTimeout(() => { throw new Error("boom"); }, 50);'],
    { stdout: "pipe", stderr: "ignore" },
  );
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).not.toBe(0);
  expect(out.indexOf(MOUSE_OFF)).toBeGreaterThan(out.indexOf(MOUSE_ON));
}, 15000);
