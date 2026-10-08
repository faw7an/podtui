/**
 * The App picks up the Omarchy theme at startup and follows a theme switch
 * done the way `omarchy-theme-set` does it (directory replaced) — P7-T4.
 * HOME points at a scratch dir, so the real home is never read.
 */

import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import * as fs from "node:fs";
import { render } from "ink";
import { App } from "../src/ui/App.tsx";
import { FakeStdin, FakeStdout, waitFor } from "./helpers/inkApp.ts";

const HOME = `/tmp/podtui-test/theme-home-${process.pid}`;
const STATE = `${HOME}/.local/state/omarchy/current`;
const realHome = process.env["HOME"];
const realExit = process.exit;

function fakeApi(): { path: string; stop: () => void } {
  const path = `/tmp/podtui-test/theme-app-${process.pid}.sock`;
  try {
    fs.unlinkSync(path);
  } catch {
    // did not exist
  }
  const server = Bun.listen<undefined>({
    unix: path,
    socket: {
      data(socket) {
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]");
        socket.end();
      },
    },
  });
  return { path, stop: () => (server.stop(true), fs.rmSync(path, { force: true })) };
}

afterEach(() => {
  process.env["HOME"] = realHome;
  process.exit = realExit;
  fs.rmSync(HOME, { recursive: true, force: true });
});

const sgr = (hex: string): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
};

describe("Omarchy theme in the App", () => {
  test("startup theme, then a switch is followed without a keypress", async () => {
    fs.mkdirSync(`${STATE}/theme`, { recursive: true });
    fs.copyFileSync("test/fixtures/omarchy/tokyo-night.colors.toml", `${STATE}/theme/colors.toml`);
    process.env["HOME"] = HOME;
    process.exit = (() => undefined) as never;
    const api = fakeApi();
    const stdout = new FakeStdout(120, 30);
    const instance = render(React.createElement(App, { socketPath: api.path }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: new FakeStdin() as unknown as NodeJS.ReadStream,
      patchConsole: false,
      exitOnCtrlC: false,
      interactive: true,
    });
    try {
      await waitFor(() => stdout.raw().includes(sgr("#7aa2f7")), "tokyo-night accent");
      // Switch like omarchy-theme-set: build next-theme, replace the dir.
      fs.mkdirSync(`${STATE}/next-theme`, { recursive: true });
      fs.copyFileSync("test/fixtures/omarchy/gruvbox.colors.toml", `${STATE}/next-theme/colors.toml`);
      fs.rmSync(`${STATE}/theme`, { recursive: true });
      fs.renameSync(`${STATE}/next-theme`, `${STATE}/theme`);
      stdout.drain();
      await waitFor(() => stdout.raw().includes(sgr("#7daea3")), "gruvbox accent after the switch");
      expect(stdout.raw()).not.toContain(sgr("#7aa2f7"));
    } finally {
      instance.unmount();
      api.stop();
    }
  }, 30000);
});
