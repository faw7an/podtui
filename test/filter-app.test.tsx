import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import { render } from "ink";
import { App } from "../src/ui/App.tsx";

/**
 * Filter popup key consumption through the real App (redesigned filter UX).
 *
 * `ink-testing-library` cannot be used: it fails on any component using hooks
 * under the installed React (verified: plain render passes, `useState` fails),
 * and the App is all hooks. So this drives Ink's own `render()` with a fake
 * TTY stdout (the `frame-ink.test.tsx` pattern) plus a fake stdin implementing
 * the readable protocol Ink reads (`read()`/`readable`/`ref`/`setRawMode` —
 * all verified against `node_modules/ink/build/components/App.js`).
 *
 * The App talks to a fake unix-socket API that answers `[]` to every GET, so
 * no daemon is involved and panels stay empty — which also puts the zero-match
 * state on screen for free. `process.exit` is stubbed (never really exits):
 * if `q` ever reached the quit branch, the stub records it instead of killing
 * the test runner.
 *
 * Frame discipline: Ink does not emit a cursor-hide per frame in this setup,
 * so "last frame" parsing goes stale. Every stage therefore drains the buffer
 * first and asserts only on freshly rendered output; the popup query reads
 * the LAST `> …▌` match, never the first.
 */

const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, "g");
const HIDE_CURSOR = `${ESC}[?25l`;

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

  private stripped(): string {
    return this.buffer.replaceAll(ANSI_RE, "");
  }

  /** Latest complete frame in the current (undrained) buffer. */
  frame(): string {
    const frames = this.stripped().split(HIDE_CURSOR).filter((f) => f.length > 0);
    return frames.at(-1) ?? this.stripped();
  }

  /** The popup query of the latest frame, if a popup is drawn. */
  popupQuery(): string | null {
    const matches = [...this.stripped().matchAll(/> ([^▌\n]*)▌/g)];
    const last = matches.at(-1);
    return last ? (last[1] ?? null) : null;
  }

  /** Forget everything rendered so far; later assertions see fresh output. */
  drain(): void {
    this.buffer = "";
  }
}

class FakeStdin extends EventEmitter {
  readonly isTTY = true;
  /** Node streams expose this; Ink treats a falsy value as unreadable. */
  readonly readable = true;
  private chunks: string[] = [];

  /* Test doubles: a real terminal owns raw mode, encoding and flow. */
  setRawMode(): void {
    /* test double */
  }
  setEncoding(): void {
    /* test double */
  }
  resume(): void {
    /* test double */
  }
  pause(): void {
    /* test double */
  }
  ref(): void {
    /* test double */
  }
  unref(): void {
    /* test double */
  }

  read(): string | null {
    const next = this.chunks.shift();
    return next ?? null;
  }

  /** Type text as terminal input. */
  type(text: string): void {
    this.chunks.push(text);
    this.emit("readable");
  }
}

async function waitFor(cond: () => boolean, what: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (cond()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Fake Podman API: every GET answers an empty JSON list. */
async function fakeApi(name: string): Promise<{ path: string; stop: () => void }> {
  const path = `/tmp/${name}.sock`;
  try {
    fs.unlinkSync(path);
  } catch {
    // did not exist
  }
  const server = Bun.listen({
    unix: path,
    socket: {
      data(socket) {
        const body = "[]";
        socket.write(
          `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`,
        );
        socket.end();
      },
    },
  });
  return { path, stop: () => server.stop(true) };
}

const realExit = process.exit;
let exitCode: number | null = null;

afterEach(() => {
  process.exit = realExit;
  exitCode = null;
});

interface Harness {
  stdout: FakeStdout;
  stdin: FakeStdin;
  stop: () => void;
}

async function launch(name: string): Promise<Harness> {
  const api = await fakeApi(name);
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
  }) as never;
  const stdout = new FakeStdout(100, 30);
  const stdin = new FakeStdin();
  const instance = render(React.createElement(App, { socketPath: api.path }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  await waitFor(() => stdout.frame().includes("Containers"), "app frame");
  return {
    stdout,
    stdin,
    stop: () => {
      instance.unmount();
      api.stop();
    },
  };
}

describe("App filter popup consumes keys", () => {
  test("q and 1 are typed into the popup; they never quit or toggle", async () => {
    const h = await launch("podtui-filter-app-test");
    try {
      h.stdout.drain();
      h.stdin.type("/");
      await waitFor(() => h.stdout.popupQuery() !== null, "popup opens");
      expect(h.stdout.popupQuery()).toBe("");
      h.stdout.drain();
      h.stdin.type("q1");
      await waitFor(() => h.stdout.popupQuery() === "q1", "q1 typed into popup");
      // The process is still alive and no exit was requested: q did not quit.
      expect(exitCode).toBeNull();
      // The list panels are untouched: 1 did not toggle anything away.
      expect(h.stdout.frame()).toContain("Containers");
    } finally {
      h.stop();
    }
  }, 30000);

  test("Enter applies and closes; Esc reopens pre-filled then clears", async () => {
    const h = await launch("podtui-filter-app-test2");
    try {
      h.stdout.drain();
      h.stdin.type("/");
      await waitFor(() => h.stdout.popupQuery() !== null, "popup opens");
      h.stdout.drain();
      h.stdin.type("q1");
      await waitFor(() => h.stdout.popupQuery() === "q1", "query typed");
      h.stdout.drain();
      h.stdin.type("\r");
      // Absence alone would pass vacuously on the just-drained buffer, so
      // require positive evidence the keypress was processed too: the kept
      // footer hints only render after endFilter applied.
      await waitFor(
        () => h.stdout.popupQuery() === null && h.stdout.frame().includes("clear filter"),
        "popup closes on Enter",
      );
      // Empty panels + kept query: the zero-match state names the query.
      expect(h.stdout.frame()).toContain("No matches for 'q1'");
      // Reopen: the popup is pre-filled with the kept text.
      h.stdout.drain();
      h.stdin.type("/");
      await waitFor(() => h.stdout.popupQuery() === "q1", "popup pre-filled");
      h.stdout.drain();
      h.stdin.type("");
      // Same vacuity guard: the base footer only renders after Esc applied.
      await waitFor(
        () => !h.stdout.frame().includes("No matches") && h.stdout.frame().includes("1-6 panel"),
        "Esc clears the filter",
      );
      expect(exitCode).toBeNull();
    } finally {
      h.stop();
    }
  }, 30000);
});
