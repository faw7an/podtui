/**
 * Mouse in the real App (P7-T8): clicks resolve against what is on screen.
 * Reports are typed into the fake stdin exactly as a terminal sends them.
 */

import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import * as fs from "node:fs";
import { render } from "ink";
import { App } from "../src/ui/App.tsx";
import { FakeStdin, FakeStdout, waitFor } from "./helpers/inkApp.ts";

const CONTAINERS = fs.readFileSync("test/fixtures/containers-list.json", "utf8");
const INSPECT = fs.readFileSync("test/fixtures/container-inspect.json", "utf8");
const IMAGES = fs.readFileSync("test/fixtures/images-list.json", "utf8");

function fakeApi() {
  const path = `/tmp/podtui-test/mouse-app-${process.pid}.sock`;
  fs.mkdirSync("/tmp/podtui-test", { recursive: true });
  fs.rmSync(path, { force: true });
  const server = Bun.listen<undefined>({
    unix: path,
    socket: {
      data(socket, data) {
        const t = data.toString().split(" ")[1] ?? "";
        const body = t.includes("/containers/json") ? CONTAINERS : t.includes("/images/json") ? IMAGES : /\/containers\/[0-9a-f]+\/json/.test(t) ? INSPECT : "[]";
        socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
        socket.end();
      },
    },
  });
  return { path, stop: () => (server.stop(true), fs.rmSync(path, { force: true })) };
}

const realExit = process.exit;
afterEach(() => {
  process.exit = realExit;
});

/** Position (0-based cells) of `text` in the latest frame. */
function where(frame: string, text: string): { x: number; y: number } {
  const lines = frame.split("\n");
  for (let y = 0; y < lines.length; y++) {
    const i = lines[y]!.indexOf(text);
    if (i >= 0) return { x: Bun.stringWidth(lines[y]!.slice(0, i)), y };
  }
  throw new Error(`"${text}" not on screen`);
}

const click = (x: number, y: number): string => `\u001B[<0;${x + 1};${y + 1}M`;
const release = (x: number, y: number): string => `\u001B[<0;${x + 1};${y + 1}m`;
const wheel = (dir: "up" | "down", x: number, y: number): string => `\u001B[<${dir === "up" ? 64 : 65};${x + 1};${y + 1}M`;

describe("mouse in the App", () => {
  test("row click selects; [N] toggles a panel; header tab focuses; detail tab switches; wheel moves; dialog blocks clicks", async () => {
    const api = fakeApi();
    process.exit = (() => undefined) as never;
    const stdout = new FakeStdout(120, 35);
    const stdin = new FakeStdin();
    const inst = render(React.createElement(App, { socketPath: api.path }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
      exitOnCtrlC: false,
      interactive: true,
    });
    try {
      await waitFor(() => stdout.frame().includes("failing"), "list");

      // Row click selects that container (the detail title follows).
      let at = where(stdout.frame(), "failing");
      stdin.type(click(at.x, at.y));
      stdin.type(release(at.x, at.y));
      await waitFor(() => stdout.frame().includes("▸ failing"), "failing selected");

      // Wheel down over the list moves the selection on.
      stdin.type(wheel("down", at.x, at.y));
      await waitFor(() => stdout.frame().includes("▸ tty-box"), "wheel moved selection");

      // Clicking a detail tab switches to it.
      at = where(stdout.frame(), "Logs Stats Env Config Top");
      stdin.type(click(at.x + "Logs Stats ".length, at.y));
      await waitFor(() => /API_TOKEN|No environment/.test(stdout.frame()), "Env tab");

      // [3] on the Images panel hides it; its header tab brings it back.
      at = where(stdout.frame(), "[3]");
      stdin.type(click(at.x + 1, at.y));
      await waitFor(() => !stdout.frame().includes("[3]"), "images hidden");
      at = where(stdout.frame(), "3 Images");
      stdin.type(click(at.x, at.y));
      await waitFor(() => stdout.frame().includes("[3]"), "images shown again");

      // With a dialog open, clicks do nothing: a click on [2] would hide the
      // Containers panel if it got through.
      stdin.type("2"); // focus Containers so `d` targets a container
      await new Promise((r) => setTimeout(r, 50));
      stdin.type("d");
      await waitFor(() => stdout.frame().includes("Remove container?"), "dialog");
      at = where(stdout.frame(), "[2]");
      stdin.type(click(at.x + 1, at.y));
      await new Promise((r) => setTimeout(r, 150));
      expect(stdout.frame()).toContain("Remove container?");
      stdin.type("\u001B");
      await waitFor(() => !stdout.frame().includes("Remove container?"), "dialog closed");
      expect(stdout.frame()).toContain("[2]");
    } finally {
      inst.unmount();
      api.stop();
    }
  }, 30000);
});
