import React from "react";
import { EventEmitter } from "node:events";
import { render } from "ink";
import { Screen } from "../src/ui/components/Screen.tsx";
import { createPodmanEngine } from "../src/engine/podman.ts";
import { PANEL_IDS } from "../src/ui/layout/types.ts";
import { defaultTheme } from "../src/theme/theme.ts";
import { buildFrameModel, type ResourceData } from "../src/ui/view/build.ts";

/**
 * Capture real frames at fixed sizes against the sandbox Podman, writing the
 * ANSI-stripped text to docs/screenshots/layout-after/<w>x<h>.txt.
 *
 * Usage: PODTUI_SOCKET=/tmp/podtui-dev/podman.sock bun run scripts/capture-after.tsx
 */

const SOCKET = process.env["PODTUI_SOCKET"] ?? "/tmp/podtui-dev/podman.sock";
const OUT_DIR = process.argv[2] ?? "docs/screenshots/layout-after";
const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, "g");

const SIZES = [
  [200, 50],
  [120, 35],
  [100, 30],
  [80, 24],
  [60, 20],
] as const;

class FakeStdout extends EventEmitter {
  columns: number;
  rows: number;
  readonly isTTY = true;
  private buffer = "";

  constructor(columns: number, rows: number) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  write = (chunk: string): boolean => {
    this.buffer += chunk;
    return true;
  };

  setSize(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
    this.emit("resize");
  }

  frame(): string {
    const frames = this.buffer.split(`${ESC}[?25l`).filter((f) => f.length > 0);
    return (frames.at(-1) ?? this.buffer).replaceAll(ANSI_RE, "");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchData(): Promise<ResourceData> {
  const engine = createPodmanEngine();
  const [containers, pods, images, volumes, networks] = await Promise.all([
    engine.listContainers(SOCKET, true),
    engine.listPods(SOCKET),
    engine.listImages(SOCKET, true),
    engine.listVolumes(SOCKET),
    engine.listNetworks(SOCKET),
  ]);
  return { containers, pods, images, volumes, networks, quadlets: [] };
}

const data = await fetchData();
const counts = data.containers.length + data.pods.length + data.images.length +
  data.volumes.length + data.networks.length;
console.log(`sandbox: ${counts} resources`);

const dir = `${OUT_DIR}`;
await Bun.write(`${dir}/.keep`, "");

for (const [cols, rows] of SIZES) {
  const stdout = new FakeStdout(cols, rows);
  const model = buildFrameModel({
    data,
    selected: Object.fromEntries(PANEL_IDS.map((id) => [id, 0])) as never,
    focus: "containers",
    now: Date.now(),
    clock: new Date().toLocaleTimeString(),
  });

  const instance = render(
    React.createElement(Screen, {
      model,
      theme: defaultTheme,
      visible: new Set(PANEL_IDS),
      zoom: null,
      detailFullscreen: false,
      color: true,
    }),
    { stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, exitOnCtrlC: false },
  );

  await sleep(600);
  const frame = stdout.frame();
  const lines = frame.split("\n").filter((l) => l.length > 0);
  const maxW = Math.max(0, ...lines.map((l) => l.length));
  const overflow = lines.length > rows || maxW > cols;

  await Bun.write(`${dir}/${cols}x${rows}.txt`, frame.endsWith("\n") ? frame : `${frame}\n`);
  console.log(
    `=== ${cols}x${rows}: lines=${lines.length}/${rows} maxW=${maxW}/${cols} ${overflow ? "OVERFLOW" : "ok"} -> ${cols}x${rows}.txt`,
  );
  instance.unmount();
  await sleep(80);
}
