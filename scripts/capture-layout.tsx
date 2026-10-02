/**
 * Temporary reproduction harness for LAYOUT_SPEC section 1.
 * Renders the CURRENT App at a forced terminal size and dumps the frame.
 *
 * ink-testing-library's Stdout hardcodes columns=100 and has no rows,
 * so we redefine both on the instance and emit "resize".
 */
import { render } from "ink-testing-library";
import React from "react";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/ui/App.tsx";

const SIZES = [
  [200, 50],
  [120, 35],
  [100, 30],
  [80, 24],
  [60, 20],
] as const;

const outDir = process.argv[2] ?? "docs/screenshots/layout-before";
mkdirSync(outDir, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[a-zA-Z]`, "g");

for (const [cols, rows] of SIZES) {
  const inst = render(React.createElement(App));

  Object.defineProperty(inst.stdout, "columns", { get: () => cols, configurable: true });
  Object.defineProperty(inst.stdout, "rows", { get: () => rows, configurable: true });
  inst.stdout.emit("resize");
  inst.rerender(React.createElement(App));

  await sleep(1200); // let the real sandbox fetches land

  const frame = inst.lastFrame() ?? "";
  const lines = frame.split("\n");
  // strip ANSI (all CSI sequences, not just SGR) for width measurement
  const strip = (s: string) => s.replaceAll(ANSI_RE, "");
  const widths = lines.map((l) => strip(l).length);
  const maxW = Math.max(0, ...widths);

  const report = [
    `size: ${cols}x${rows}`,
    `lines: ${lines.length} (rows=${rows})  ${lines.length > rows ? "OVERFLOW" : "ok"}`,
    `max line width: ${maxW} (cols=${cols})  ${maxW > cols ? "OVERFLOW" : "ok"}`,
    `vertical-letter pattern present: ${/\bS\nT\nA\nT\nU\nS\b/.test(strip(frame)) ? "YES" : "no"}`,
    "",
    "----- frame -----",
    frame,
  ].join("\n");

  const name = `${cols}x${rows}.txt`;
  writeFileSync(join(outDir, name), report, "utf8");
  console.log(`=== ${cols}x${rows}: lines=${lines.length}/${rows} maxW=${maxW}/${cols} -> ${name}`);
  inst.unmount();
}