/**
 * Auto-hide through the real App: only containers exist, so the other panels
 * hide after their first load; numbers stay in the header; a panel comes back
 * when its data appears.
 */

import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import * as fs from "node:fs";
import { render } from "ink";
import { App } from "../src/ui/App.tsx";
import { FakeStdin, FakeStdout, waitFor } from "./helpers/inkApp.ts";

const CONTAINERS = fs.readFileSync("test/fixtures/containers-list.json", "utf8");
const VOLUMES = fs.readFileSync("test/fixtures/volumes-list.json", "utf8");
const INSPECT = fs.readFileSync("test/fixtures/container-inspect.json", "utf8");

const realExit = process.exit;
afterEach(() => {
  process.exit = realExit;
});

describe("empty panels in the App", () => {
  test("hide after loading, keep their numbers, explain on their key, and come back", async () => {
    let haveVolumes = false;
    const path = `/tmp/podtui-test/autohide-${process.pid}.sock`;
    fs.mkdirSync("/tmp/podtui-test", { recursive: true });
    fs.rmSync(path, { force: true });
    const server = Bun.listen<undefined>({
      unix: path,
      socket: {
        data(socket, data) {
          const t = data.toString().split(" ")[1] ?? "";
          const body = t.includes("/containers/json")
            ? CONTAINERS
            : /\/containers\/[0-9a-f]+\/json/.test(t)
              ? INSPECT
              : t.includes("/volumes/json") && !t.includes("dangling") && haveVolumes
                ? VOLUMES
                : "[]";
          socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
          socket.end();
        },
      },
    });
    process.exit = (() => undefined) as never;
    const stdout = new FakeStdout(120, 35);
    const stdin = new FakeStdin();
    const inst = render(React.createElement(App, { socketPath: path }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
      exitOnCtrlC: false,
      interactive: true,
    });
    try {
      await waitFor(() => stdout.frame().includes("[2] Containers") && !stdout.frame().includes("[4] Volumes"), "empty panels hidden");
      const f = stdout.frame();
      for (const gone of ["[1] Pods", "[3] Images", "[4] Volumes", "[5] Networks", "[6] Quadlets"]) expect(f).not.toContain(gone);
      // The header keeps every number.
      expect(f.split("\n")[0]).toMatch(/1 Pods.*2 Containers.*3 Images.*4 Volumes.*5 Networks.*6 Quadlets/);

      stdin.type("6");
      await waitFor(() => stdout.frame().includes("No quadlets yet: panel 6 appears when there are some."), "explanation");

      haveVolumes = true; // a volume appears: panel 4 comes back by itself
      await waitFor(() => stdout.frame().includes("[4] Volumes"), "volumes back", 15000);
    } finally {
      inst.unmount();
      server.stop(true);
      fs.rmSync(path, { force: true });
    }
  }, 30000);
});
