/**
 * Actions through the real App (P4-T5/T6) against a fake Podman socket that
 * records every non-GET request: the dialog blocks the call until confirmed,
 * cancel sends nothing, and an engine error is shown while the app lives on.
 */

import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import * as fs from "node:fs";
import { render } from "ink";
import { App } from "../src/ui/App.tsx";
import { FakeStdin, FakeStdout, waitFor } from "./helpers/inkApp.ts";

const fixture = (f: string): string => fs.readFileSync(`test/fixtures/${f}`, "utf8");
const CONTAINERS = fixture("containers-list.json");
const WEB_ID = (JSON.parse(CONTAINERS) as { Id: string; Names: string[] }[]).find((c) => c.Names[0] === "web")!.Id;

function fakePodman(fail?: { match: RegExp; status: number; message: string }) {
  fs.mkdirSync("/tmp/podtui-test", { recursive: true });
  const path = `/tmp/podtui-test/actions-app-${process.pid}.sock`;
  try {
    fs.unlinkSync(path);
  } catch {
    // did not exist
  }
  const actions: string[] = [];
  const server = Bun.listen<undefined>({
    unix: path,
    socket: {
      data(socket, data) {
        const [method = "", target = ""] = data.toString().split(" ");
        const reply = (status: number, body: string, reason = "OK"): void => {
          socket.write(
            `HTTP/1.1 ${status} ${reason}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
          );
          socket.end();
        };
        if (method !== "GET") {
          actions.push(`${method} ${target.replace(/^\/v[\d.]+\/libpod/, "")}`);
          if (fail?.match.test(target)) {
            reply(fail.status, JSON.stringify({ cause: fail.message, message: fail.message, response: fail.status }), "Error");
          } else {
            socket.write("HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
            socket.end();
          }
          return;
        }
        if (target.includes("/containers/json")) return reply(200, CONTAINERS);
        if (target.includes("/pods/json")) return reply(200, fixture("pods-list.json"));
        if (/\/containers\/[0-9a-f]+\/json/.test(target)) return reply(200, fixture("container-inspect.json"));
        return reply(200, "[]");
      },
    },
  });
  return {
    path,
    actions,
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

async function launch(fail?: Parameters<typeof fakePodman>[0]) {
  const api = fakePodman(fail);
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
  stdin.type("j"); // select `web` (running)
  await waitFor(() => stdout.frame().includes("web · running"), "web selected");
  return {
    api,
    stdout,
    stdin,
    stop: () => {
      instance.unmount();
      api.stop();
    },
  };
}

describe("actions in the App", () => {
  test("d opens a dialog naming the target; Esc and n send nothing", async () => {
    const h = await launch();
    try {
      h.stdin.type("d");
      await waitFor(() => h.stdout.frame().includes("Remove container?"), "dialog");
      expect(h.stdout.frame()).toContain("Remove container web.");
      expect(h.stdout.frame()).toContain("It is running: it will be stopped first.");
      // Keys behind the dialog are dead: q does not quit, s does not start.
      h.stdin.type("s");
      h.stdin.type("\u001B");
      await waitFor(() => !h.stdout.frame().includes("Remove container?"), "dialog closed by Esc");
      h.stdin.type("d");
      await waitFor(() => h.stdout.frame().includes("Remove container?"), "dialog again");
      h.stdin.type("n");
      await waitFor(() => !h.stdout.frame().includes("Remove container?"), "dialog closed by n");
      await new Promise((r) => setTimeout(r, 200));
      expect(h.api.actions).toEqual([]);
    } finally {
      h.stop();
    }
  }, 30000);

  test("Enter on the default Cancel sends nothing; y removes exactly that container, forced", async () => {
    const h = await launch();
    try {
      h.stdin.type("d");
      await waitFor(() => h.stdout.frame().includes("Remove container?"), "dialog");
      h.stdin.type("\r");
      await waitFor(() => !h.stdout.frame().includes("Remove container?"), "closed");
      expect(h.api.actions).toEqual([]);
      h.stdin.type("d");
      await waitFor(() => h.stdout.frame().includes("Remove container?"), "dialog");
      h.stdin.type("y");
      await waitFor(() => h.api.actions.length === 1, "one request");
      // Forced removal also carries the container's own stop grace period
      // (inspect StopTimeout = 10 in the fixture; DECISIONS fix/review).
      expect(h.api.actions).toEqual([`DELETE /containers/${WEB_ID}?force=true&timeout=10`]);
      await waitFor(() => h.stdout.frame().includes("container web removed"), "ok notice");
    } finally {
      h.stop();
    }
  }, 30000);

  test("s starts at once (no dialog); a Podman refusal is shown and the app stays alive", async () => {
    const h = await launch({ match: /\/start$/, status: 500, message: "container already being started elsewhere" });
    try {
      h.stdin.type("s");
      await waitFor(() => h.api.actions.length === 1, "start request");
      expect(h.api.actions).toEqual([`POST /containers/${WEB_ID}/start`]);
      // A failure opens a dialog (phase-4/error-dialog) with Podman's text.
      await waitFor(() => h.stdout.frame().includes("Could not start container web"), "error dialog");
      expect(h.stdout.frame()).toContain("container already being started elsewhere");
      // The dialog holds the keyboard until acknowledged…
      h.stdin.type("s");
      await new Promise((r) => setTimeout(r, 150));
      expect(h.api.actions).toHaveLength(1);
      h.stdin.type("\u001B");
      await waitFor(() => !h.stdout.frame().includes("Could not start"), "dialog closed");
      // …then the app is alive and responsive.
      h.stdin.type("?");
      await waitFor(() => h.stdout.frame().includes("Actions") || h.stdout.frame().includes("keys"), "help opens");
    } finally {
      h.stop();
    }
  }, 30000);
});
