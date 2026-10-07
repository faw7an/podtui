import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import {
  EngineError,
  mapHttpError,
  request,
  streamChunks,
  streamLines,
  type StreamOptions,
} from "../src/api/client.ts";

/**
 * R-07: the request layer's failure paths.
 *
 * Before this, `request`, `streamChunks` and `streamLines` had no tests at all
 * (only EngineError / mapHttpError / parseJson were covered), so timeout and
 * abort behaviour was unverified — including a misleading message that reported
 * *every* abort as "Request timeout".
 */

const SOCKET = "/tmp/podtui-dev/podman.sock";
const BAD_SOCKET = "/nonexistent/podman.sock";

/** A unix socket server that accepts connections and then never replies. */
async function hangingSocket(name: string): Promise<{ path: string; stop: () => void }> {
  const path = `/tmp/${name}.sock`;
  try {
    fs.unlinkSync(path);
  } catch {
    // did not exist
  }
  const server = Bun.listen({
    unix: path,
    socket: {
      data() {
        // Swallow everything, answer nothing.
      },
    },
  });
  return { path, stop: () => server.stop(true) };
}

describe("request: unreachable socket", () => {
  test("a dead socket path reports 'unreachable' and does not claim a timeout", async () => {
    try {
      await request(BAD_SOCKET, "/version");
      throw new Error("expected the request to fail");
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      const err = e as EngineError;
      expect(err.kind).toBe("unreachable");
      expect(err.message).not.toContain("timeout");
    }
  });
});

describe("request: timeout", () => {
  test("a hanging server aborts at the requested timeout and says so", async () => {
    const server = await hangingSocket("podtui-audit-hang");
    const started = Date.now();
    try {
      await request(server.path, "/version", { timeout: 400 });
      throw new Error("expected the request to time out");
    } catch (e) {
      const err = e as EngineError;
      expect(err).toBeInstanceOf(EngineError);
      expect(err.kind).toBe("unreachable");
      expect(err.message).toContain("timeout");
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(350);
      expect(elapsed).toBeLessThan(5000);
    } finally {
      server.stop();
    }
  }, 15000);
});

describe("request: external abort", () => {
  test("aborting reports an abort, NOT a timeout", async () => {
    const controller = new AbortController();
    // Long timeout, so only the abort can end this request.
    const pending = request(BAD_SOCKET, "/version", { signal: controller.signal, timeout: 30000 });
    controller.abort();
    try {
      await pending;
      throw new Error("expected the request to abort");
    } catch (e) {
      const err = e as EngineError;
      expect(err).toBeInstanceOf(EngineError);
      // The old code mapped every AbortError to "Request timeout", which made a
      // deliberate cancellation indistinguishable from a slow daemon.
      expect(err.message.toLowerCase()).toContain("abort");
      expect(err.message.toLowerCase()).not.toContain("timeout");
    }
  });

  test("an already-aborted signal rejects immediately", async () => {
    const controller = new AbortController();
    controller.abort();
    try {
      await request(BAD_SOCKET, "/version", { signal: controller.signal });
      throw new Error("expected the request to abort");
    } catch (e) {
      expect((e as EngineError).message.toLowerCase()).toContain("abort");
    }
  });

  test("aborting a hanging request ends it promptly", async () => {
    const server = await hangingSocket("podtui-audit-hang2");
    const controller = new AbortController();
    const started = Date.now();
    const pending = request(server.path, "/version", { signal: controller.signal, timeout: 30000 });
    setTimeout(() => controller.abort(), 200);
    try {
      await pending;
      throw new Error("expected the request to abort");
    } catch (e) {
      expect((e as EngineError).message.toLowerCase()).toContain("abort");
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      server.stop();
    }
  }, 15000);
});

describe("request: HTTP error mapping", () => {
  const cases: [number, EngineError["kind"]][] = [
    [404, "notFound"],
    [409, "conflict"],
    // Was "unreachable". Wrong: Podman answers 500 for ordinary refusals
    // (e.g. removing a running container) while perfectly reachable — see
    // test/client-errors.test.ts and DECISIONS 2026-10-08.
    [500, "unknown"],
    [502, "unreachable"],
    [503, "unreachable"],
    [504, "unreachable"],
  ];

  for (const [status, kind] of cases) {
    test(`HTTP ${status} maps to ${kind}`, () => {
      expect(mapHttpError(status, "body").kind).toBe(kind);
    });
  }

  test("an unmapped status is 'unknown' and keeps the status code", () => {
    const err = mapHttpError(418, "teapot");
    expect(err.kind).toBe("unknown");
    expect(err.statusCode).toBe(418);
  });
});

describe("streams", () => {
  test("streamChunks on a dead socket throws a readable typed error", async () => {
    // Silently yielding nothing would hide "Podman is down"; the caller must
    // be able to show the reason (FR-8).
    let seen: unknown;
    try {
      for await (const _c of streamChunks(BAD_SOCKET, "/events?stream=true")) {
        void _c;
      }
    } catch (e) {
      seen = e;
    }
    expect(seen).toBeInstanceOf(EngineError);
    expect((seen as EngineError).kind).toBe("unreachable");
    expect((seen as EngineError).message).toContain("connect");
  });

  test("streamLines surfaces the same error", async () => {
    let seen: unknown;
    try {
      for await (const _l of streamLines(BAD_SOCKET, "/events?stream=true")) {
        void _l;
      }
    } catch (e) {
      seen = e;
    }
    expect(seen).toBeInstanceOf(EngineError);
    expect((seen as EngineError).kind).toBe("unreachable");
  });

  test("a pre-aborted stream yields nothing and returns promptly", async () => {
    const controller = new AbortController();
    controller.abort();
    const started = Date.now();
    const chunks: Uint8Array[] = [];
    for await (const c of streamChunks(SOCKET, "/events?stream=true", { signal: controller.signal })) {
      chunks.push(c);
    }
    expect(chunks).toHaveLength(0);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 10000);

  test("StreamOptions exposes no dead `timeout` field", () => {
    // `timeout` used to be declared on StreamOptions and never read; an option
    // that silently does nothing is worse than no option at all. Checked at the
    // type level, so it cannot rot silently.
    type HasTimeout = "timeout" extends keyof StreamOptions ? true : false;
    const hasTimeout: HasTimeout = false;
    expect(hasTimeout).toBe(false);
  });
});