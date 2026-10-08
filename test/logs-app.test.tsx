/**
 * The Logs tab wired into the real App (P3-T2/T4/T9), against a fake Podman
 * socket that serves the recorded container list and keeps every `/logs`
 * request open like a real `follow=true` stream, counting opens and closes.
 *
 * P3-T9: switching selection, switching tab and quitting must each close the
 * stream; only one may be open at a time.
 */

import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import * as fs from "node:fs";
import type { Socket } from "bun";
import { render } from "ink";
import { App } from "../src/ui/App.tsx";
import { FakeStdin, FakeStdout, waitFor } from "./helpers/inkApp.ts";

const CONTAINERS = fs.readFileSync("test/fixtures/containers-list.json", "utf8");
const INSPECT = fs.readFileSync("test/fixtures/container-inspect.json", "utf8");
const NAMES = new Map<string, string>(
  (JSON.parse(CONTAINERS) as { Id: string; Names: string[] }[]).map((c) => [c.Id, c.Names[0] ?? ""]),
);

function frame(message: string): Uint8Array {
  const payload = new TextEncoder().encode(`2026-10-08T09:46:07.599095245+03:00 ${message}`);
  const out = new Uint8Array(8 + payload.length);
  out[0] = 1;
  new DataView(out.buffer).setUint32(4, payload.length);
  out.set(payload, 8);
  return out;
}

interface FakePodman {
  path: string;
  opened: string[];
  closed: string[];
  open(): number;
  /** Open `/containers/stats` streams. */
  statsOpen(): number;
  statsOpened: string[];
  stop(): void;
}

function fakePodman(): FakePodman {
  fs.mkdirSync("/tmp/podtui-test", { recursive: true });
  const path = `/tmp/podtui-test/logs-app-${process.pid}.sock`;
  try {
    fs.unlinkSync(path);
  } catch {
    // did not exist
  }
  const opened: string[] = [];
  const closed: string[] = [];
  const streams = new Map<Socket<undefined>, string>();
  const statsStreams = new Set<Socket<undefined>>();
  const statsOpened: string[] = [];
  const statsLine = (name: string): string =>
    `${JSON.stringify({ Error: null, Stats: [{ Name: name, CPU: 1.5, AvgCPU: 0.5, MemUsage: 1000, MemLimit: 2000, MemPerc: 50, Network: null, BlockInput: 0, BlockOutput: 0, PIDs: 3 }] })}\n`;

  const server = Bun.listen<undefined>({
    unix: path,
    socket: {
      data(socket, data) {
        const target = data.toString().split(" ")[1] ?? "";
        const logs = /\/containers\/([0-9a-f]+)\/logs/.exec(target);
        const stats = /\/containers\/stats\?containers=([^&]+)/.exec(target);
        if (stats?.[1] && target.includes("stream=true")) {
          const id = decodeURIComponent(stats[1]);
          const name = NAMES.get(id) ?? id;
          statsOpened.push(name);
          statsStreams.add(socket);
          socket.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n");
          socket.write(statsLine(name));
          return;
        }
        if (logs?.[1]) {
          const name = NAMES.get(logs[1]) ?? "?";
          opened.push(name);
          streams.set(socket, name);
          // No Content-Length: like a follow stream, the body runs until close.
          socket.write("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n");
          socket.write(frame(`hello from ${name}\n`));
          socket.write(frame(`ERROR boom in ${name}\n`));
          return;
        }
        const body = target.includes("/containers/json")
          ? CONTAINERS
          : target.includes("/json") && target.includes("/containers/")
            ? INSPECT
            : "[]";
        socket.write(
          `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
        );
        socket.end();
      },
      close(socket) {
        statsStreams.delete(socket);
        const name = streams.get(socket);
        if (name !== undefined) {
          closed.push(name);
          streams.delete(socket);
        }
      },
    },
  });

  return {
    path,
    opened,
    closed,
    open: () => streams.size,
    statsOpen: () => statsStreams.size,
    statsOpened,
    stop: () => {
      server.stop(true);
      try {
        fs.unlinkSync(path);
      } catch {
        // already gone
      }
    },
  };
}

const realExit = process.exit;
afterEach(() => {
  process.exit = realExit;
});

async function launch() {
  const api = fakePodman();
  process.exit = (() => undefined) as never;
  const stdout = new FakeStdout(120, 30);
  const stdin = new FakeStdin();
  const instance = render(React.createElement(App, { socketPath: api.path }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
    exitOnCtrlC: false,
    interactive: true,
  });
  await waitFor(() => stdout.frame().includes("chatty"), "container list");
  return { api, stdout, stdin, unmount: () => instance.unmount() };
}

describe("Logs tab in the App", () => {
  test("one stream at a time; selection, tab and unmount each close it", async () => {
    const h = await launch();
    try {
      // First j selects `web`; `]` twice goes Config → Top → Logs.
      h.stdin.type("j");
      await new Promise((r) => setTimeout(r, 50));
      h.stdin.type("]");
      h.stdin.type("]");
      await waitFor(() => h.stdout.frame().includes("hello from web"), "web logs");
      expect(h.api.opened).toEqual(["web"]);
      expect(h.api.open()).toBe(1);

      // The ERROR line is there too, and the tab title names the container.
      expect(h.stdout.frame()).toContain("ERROR boom in web");

      // New selection: the old stream closes, the new one opens.
      h.stdin.type("j");
      await waitFor(() => h.stdout.frame().includes("hello from chatty"), "chatty logs");
      await waitFor(() => h.api.closed.includes("web"), "web stream closed");
      expect(h.api.open()).toBe(1);

      // Leaving the tab closes the stream.
      h.stdin.type("]");
      await waitFor(() => h.api.open() === 0, "stream closed on tab change");
      expect(h.api.closed).toEqual(["web", "chatty"]);

      // Back to Logs reopens it.
      h.stdin.type("[");
      await waitFor(() => h.api.open() === 1, "stream reopened");
    } finally {
      h.unmount();
      await waitFor(() => h.api.open() === 0, "stream closed on unmount");
      h.api.stop();
    }
  }, 30000);

  test("e shows errors only; / search in the focused detail finds and counts", async () => {
    const h = await launch();
    try {
      h.stdin.type("j");
      await new Promise((r) => setTimeout(r, 50));
      h.stdin.type("]");
      h.stdin.type("]");
      await waitFor(() => h.stdout.frame().includes("hello from web"), "web logs");

      h.stdin.type("e");
      await waitFor(() => h.stdout.frame().includes("errors only"), "errors-only hint");
      expect(h.stdout.frame()).not.toContain("hello from web");
      expect(h.stdout.frame()).toContain("ERROR boom in web");
      h.stdin.type("e");
      await waitFor(() => h.stdout.frame().includes("hello from web"), "all lines back");

      // Enter opens the detail fullscreen (focus moves there), then search.
      h.stdin.type("\r");
      await waitFor(() => h.stdout.frame().includes("p pause"), "logs footer");
      h.stdin.type("/");
      await waitFor(() => h.stdout.frame().includes("/▌"), "search input");
      h.stdin.type("boom");
      await waitFor(() => h.stdout.frame().includes("/boom▌"), "typed query");
      h.stdin.type("\r");
      await waitFor(() => h.stdout.frame().includes("/boom 1/1"), "match count");

      // Esc follows the LAYOUT_SPEC chain: fullscreen closes before a kept
      // search (same rank as a list filter), and the next Esc clears it.
      h.stdin.type("\u001B");
      await waitFor(() => h.stdout.frame().includes("Enter inspect"), "back to the list");
      expect(h.stdout.frame()).toContain("/boom 1/1");
      h.stdin.type("\u001B");
      await waitFor(() => !h.stdout.frame().includes("/boom"), "search cleared");
    } finally {
      h.unmount();
      h.api.stop();
    }
  }, 30000);

  test("hiding the detail pane (zoom a list) closes the log stream; unzoom reopens it", async () => {
    const h = await launch();
    try {
      h.stdin.type("j");
      await new Promise((r) => setTimeout(r, 50));
      h.stdin.type("]");
      h.stdin.type("]");
      await waitFor(() => h.api.open() === 1, "logs stream open");
      h.stdin.type("z"); // zoom the Containers list: the detail pane is gone
      await waitFor(() => h.api.open() === 0, "stream closed while the pane is hidden");
      h.stdin.type("\u001B"); // unzoom
      await waitFor(() => h.api.open() === 1, "stream reopened");
    } finally {
      h.unmount();
      h.api.stop();
    }
  }, 30000);

  test("Stats: one live stream for a running container, closed on tab change", async () => {
    const h = await launch();
    try {
      h.stdin.type("j"); // web (running)
      await new Promise((r) => setTimeout(r, 50));
      h.stdin.type("["); // Config → Env
      h.stdin.type("["); // Env → Stats
      // The pane is tall enough for the charts (docs/design/stats-reference).
      await waitFor(() => h.stdout.frame().includes("CPU (%): 1.50"), "stats chart caption");
      expect(h.api.statsOpened).toEqual(["web"]);
      expect(h.api.statsOpen()).toBe(1);
      h.stdin.type("[");
      await waitFor(() => h.api.statsOpen() === 0, "stats stream closed on tab change");
    } finally {
      h.unmount();
      h.api.stop();
    }
  }, 30000);

  test("Stats on a stopped container opens no stream and says why", async () => {
    const h = await launch();
    try {
      h.stdin.type("j"); // web
      await new Promise((r) => setTimeout(r, 50));
      for (const k of ["j", "j"]) {
        // One key per chunk: "jj" in one read is a single two-character input.
        h.stdin.type(k);
        await new Promise((r) => setTimeout(r, 50));
      }
      // (The fake serves `web`'s inspect for every id, so the title cannot
      // confirm the selection; the Stats message below comes from the list.)
      h.stdin.type("[");
      h.stdin.type("[");
      await waitFor(() => h.stdout.frame().includes("failing is not running (exited)."), "not-running message");
      expect(h.api.statsOpened).toEqual([]);
    } finally {
      h.unmount();
      h.api.stop();
    }
  }, 30000);
});
