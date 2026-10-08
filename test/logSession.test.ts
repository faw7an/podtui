/**
 * Tests for `src/ui/view/logSession.ts` (P3-T2 throttling, P3-T9 lifecycle).
 *
 * A fake engine stands in for Podman: it counts opened and closed streams and
 * lets each test push frames, end the stream, or fail it.
 */

import { describe, expect, test } from "bun:test";
import type { LogFrame } from "../src/api/demux.ts";
import { LogBuffer } from "../src/util/logBuffer.ts";
import { startLogSession, type LogStreamStatus } from "../src/ui/view/logSession.ts";

interface FakeStream {
  push(message: string): void;
  end(): void;
  fail(error: Error): void;
  signal?: AbortSignal;
  options?: Record<string, unknown>;
}

function fakeEngine() {
  const streams: FakeStream[] = [];
  let open = 0;
  let closed = 0;

  const engine = {
    containerLogs(
      _socket: string,
      _id: string,
      options: { follow?: boolean; tail?: number; timestamps?: boolean; signal?: AbortSignal } = {},
    ): AsyncGenerator<LogFrame> {
      const queue: LogFrame[] = [];
      let wake: (() => void) | undefined;
      let done = false;
      let error: Error | undefined;
      const poke = (): void => {
        wake?.();
        wake = undefined;
      };
      const stream: FakeStream = {
        push: (message) => {
          queue.push({ stream: "stdout", timestamp: new Date(0), message });
          poke();
        },
        end: () => {
          done = true;
          poke();
        },
        fail: (e) => {
          error = e;
          poke();
        },
        signal: options.signal,
        options,
      };
      streams.push(stream);
      options.signal?.addEventListener("abort", () => {
        error = Object.assign(new Error("Request aborted"), { name: "AbortError" });
        poke();
      });
      open++;
      return (async function* () {
        try {
          for (;;) {
            while (queue.length > 0) yield queue.shift() as LogFrame;
            if (error) throw error;
            if (done) return;
            await new Promise<void>((r) => (wake = r));
          }
        } finally {
          closed++;
        }
      })();
    },
  };

  return { engine, streams, counts: () => ({ open, closed }) };
}

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

function session(throttleMs = 20) {
  const fake = fakeEngine();
  const buffer = new LogBuffer();
  const statuses: LogStreamStatus["kind"][] = [];
  let notifications = 0;
  const stop = startLogSession(fake.engine, "/tmp/podtui-test/x.sock", "abc", {
    buffer,
    throttleMs,
    onLines: () => notifications++,
    onStatus: (s) => statuses.push(s.kind),
  });
  return { ...fake, buffer, statuses, stop, notifications: () => notifications };
}

describe("startLogSession", () => {
  test("opens one follow stream with timestamps and the default tail", async () => {
    const s = session();
    await tick();
    expect(s.counts()).toEqual({ open: 1, closed: 0 });
    expect(s.streams[0]?.options).toMatchObject({ follow: true, timestamps: true, tail: 1000 });
    s.stop();
  });

  test("stop aborts the request and the stream closes", async () => {
    const s = session();
    await tick();
    s.stop();
    await tick();
    expect(s.streams[0]?.signal?.aborted).toBe(true);
    expect(s.counts()).toEqual({ open: 1, closed: 1 });
    // Our own abort is not an error.
    expect(s.statuses).toEqual(["connecting"]);
  });

  test("a burst of frames is coalesced into one UI notification per throttle window", async () => {
    const s = session(30);
    await tick();
    for (let i = 0; i < 500; i++) s.streams[0]?.push(`line ${i}\n`);
    await tick(5);
    expect(s.buffer.length).toBe(500);
    expect(s.notifications()).toBe(0);
    await tick(40);
    expect(s.notifications()).toBe(1);
    expect(s.statuses).toEqual(["connecting", "live"]);
    s.stop();
  });

  test("no notification fires after stop, even with one pending", async () => {
    const s = session(30);
    await tick();
    s.streams[0]?.push("x\n");
    await tick(1);
    s.stop();
    await tick(50);
    expect(s.notifications()).toBe(0);
  });

  test("a stream the server closes reports `ended` after flushing lines", async () => {
    const s = session(1000);
    await tick();
    s.streams[0]?.push("last words\n");
    s.streams[0]?.end();
    await tick(5);
    expect(s.statuses).toEqual(["connecting", "live", "ended"]);
    expect(s.notifications()).toBe(1);
    expect(s.counts().closed).toBe(1);
  });

  test("a failing stream reports Podman's message", async () => {
    const s = session();
    await tick();
    s.streams[0]?.fail(new Error("using --follow with the journald --log-driver but without the journald --events-backend (file) is not supported"));
    await tick(5);
    expect(s.statuses.at(-1)).toBe("error");
    s.stop();
  });

  test("20 rapid open/stop cycles leave nothing open", async () => {
    const fake = fakeEngine();
    for (let i = 0; i < 20; i++) {
      const stop = startLogSession(fake.engine, "/tmp/podtui-test/x.sock", `c${i}`, {
        buffer: new LogBuffer(),
        onLines: () => undefined,
        onStatus: () => undefined,
      });
      await tick();
      stop();
    }
    await tick(5);
    expect(fake.counts()).toEqual({ open: 20, closed: 20 });
  });
});
