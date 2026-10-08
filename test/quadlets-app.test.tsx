/**
 * Quadlets through the real App (P6) with a fake Podman socket and a fake
 * command runner — nothing reaches the real user systemd.
 */

import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import * as fs from "node:fs";
import { render } from "ink";
import { App } from "../src/ui/App.tsx";
import type { CommandRunner } from "../src/engine/systemd.ts";
import { FakeStdin, FakeStdout, waitFor } from "./helpers/inkApp.ts";

const QUADLETS = fs.readFileSync("test/fixtures/quadlets-list.json", "utf8");
const HELLO = "[Container]\nImage=docker.io/library/alpine:latest\nExec=sleep 300\n";

function fakePodman() {
  fs.mkdirSync("/tmp/podtui-test", { recursive: true });
  const path = `/tmp/podtui-test/quadlets-app-${process.pid}.sock`;
  try {
    fs.unlinkSync(path);
  } catch {
    // did not exist
  }
  const server = Bun.listen<undefined>({
    unix: path,
    socket: {
      data(socket, data) {
        const target = data.toString().split(" ")[1] ?? "";
        const body = target.includes("/quadlets/json")
          ? QUADLETS
          : target.includes("/quadlets/hello.container/file")
            ? HELLO
            : target.includes("/info")
              ? JSON.stringify({ host: { security: { rootless: true } } })
              : "[]";
        socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
        socket.end();
      },
    },
  });
  return {
    path,
    stop: () => {
      server.stop(true);
      try {
        fs.unlinkSync(path);
      } catch {
        // gone
      }
    },
  };
}

function fakeRunner() {
  const calls: string[] = [];
  let helloActive = true;
  const runner: CommandRunner = {
    async run(argv) {
      calls.push(argv.join(" "));
      if (argv.includes("show")) {
        const blocks = argv
          .filter((a) => a.endsWith(".service"))
          .map((u) =>
            u === "hello.service"
              ? `Id=${u}\nLoadState=loaded\nActiveState=${helloActive ? "active" : "inactive"}\nSubState=${helloActive ? "running" : "dead"}\n`
              : `Id=${u}\nLoadState=not-found\nActiveState=inactive\nSubState=dead\n`,
          );
        return { code: 0, out: blocks.join("\n"), err: "" };
      }
      if (argv.includes("stop")) helloActive = false;
      if (argv.includes("status")) return { code: 0, out: "● hello.service - hello\n", err: "" };
      if (argv.includes("cat")) return { code: 0, out: "[Unit]\nDescription=hello\n", err: "" };
      return { code: 0, out: "", err: "" };
    },
    async *lines(argv, signal) {
      calls.push(argv.join(" "));
      yield JSON.stringify({ MESSAGE: "hello from the journal", PRIORITY: "6", __REALTIME_TIMESTAMP: "1791314014767061" });
      yield JSON.stringify({ MESSAGE: "something failed", PRIORITY: "3", __REALTIME_TIMESTAMP: "1791314014767062" });
      await new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true }));
    },
  };
  return { runner, calls };
}

const realExit = process.exit;
afterEach(() => {
  process.exit = realExit;
});

describe("Quadlets panel in the App", () => {
  test("list with states, File tab, confirmed stop, live journal — all via the fake runner", async () => {
    const api = fakePodman();
    const { runner, calls } = fakeRunner();
    process.exit = (() => undefined) as never;
    const stdout = new FakeStdout(140, 36);
    const stdin = new FakeStdin();
    const instance = render(React.createElement(App, { socketPath: api.path, runner }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
      exitOnCtrlC: false,
      interactive: true,
    });
    try {
      await waitFor(() => stdout.frame().includes("hello.container"), "quadlet list");
      await waitFor(() => /hello\.container +ctr +● active \(running\)/.test(stdout.frame()), "state from systemctl");
      expect(calls[0]).toStartWith("systemctl --user show data-volume.service grp-pod.service hello.service");

      stdin.type("6"); // focus Quadlets
      for (const k of ["j", "j", "j"]) {
        await new Promise((r) => setTimeout(r, 40));
        stdin.type(k); // data.volume, grp.pod, hello.container
      }
      await waitFor(() => stdout.frame().includes("Image=docker.io/library/alpine:latest"), "File tab");
      expect(stdout.frame()).toContain("File Unit Journal");

      stdin.type("S");
      await waitFor(() => stdout.frame().includes("Stop unit?"), "confirm for a running unit");
      stdin.type("y");
      await waitFor(() => calls.includes("systemctl --user stop hello.service"), "stop sent");

      stdin.type("]");
      stdin.type("]"); // File → Unit → Journal
      await waitFor(() => stdout.frame().includes("something failed"), "journal lines");
      expect(calls).toContain("journalctl --user -u hello.service -f -n 200 -o json --no-pager");
      expect(calls.some((c) => c.includes("start") || c.includes("daemon-reload"))).toBe(false);
    } finally {
      instance.unmount();
      api.stop();
    }
  }, 30000);
});
