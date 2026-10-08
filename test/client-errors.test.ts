import { describe, expect, test } from "bun:test";
import {
  EngineError,
  connectionError,
  get,
  mapHttpError,
  postVoid,
  streamChunks,
} from "../src/api/client.ts";
import { actionResult, createPodmanEngine } from "../src/engine/podman.ts";
import { fakeUnixServer, httpResponse } from "./helpers/unixServer.ts";
import { assertSandboxSocket } from "./helpers/sandboxGuard.ts";

/**
 * Error mapping, review 2026-10-08. Every Podman status/body below was
 * observed live on Podman 5.8.4; every Bun error shape was observed on
 * Bun 1.3.10 (see docs/DECISIONS.md).
 */

describe("mapHttpError keeps Podman's own message", () => {
  test("500 is 'unknown' — Podman answered — and says what went wrong", () => {
    const body = JSON.stringify({
      cause: "container state improper",
      message: "cannot remove container abc as it is running - running or paused containers cannot be removed without force: container state improper",
      response: 500,
    });
    const err = mapHttpError(500, body);
    expect(err.kind).toBe("unknown");
    expect(err.message).toContain("as it is running");
    expect(err.message).not.toContain("unreachable");
  });

  test("404 and 409 carry the server message", () => {
    const nf = mapHttpError(404, JSON.stringify({ cause: "no such container", message: 'no container with name or ID "nope" found: no such container', response: 404 }));
    expect(nf.kind).toBe("notFound");
    expect(nf.message).toBe('no container with name or ID "nope" found: no such container');
    const conflict = mapHttpError(409, JSON.stringify({ cause: "image is in use by a container", message: "image used by 45cd: image is in use by a container", response: 409 }));
    expect(conflict.kind).toBe("conflict");
    expect(conflict.message).toContain("in use");
  });

  test("a pod partial failure (409 + Errs) is described, not reported as a bare conflict", () => {
    expect(mapHttpError(409, JSON.stringify({ Errs: [{}, {}], Id: "p" })).message).toBe("2 containers failed");
    expect(mapHttpError(409, JSON.stringify({ Errs: ["starting container x: boom"], Id: "p" })).message).toBe("starting container x: boom");
  });

  test("non-JSON bodies are used as-is, empty ones fall back to the status", () => {
    expect(mapHttpError(418, "I'm a teapot").message).toBe("I'm a teapot");
    expect(mapHttpError(418, "").message).toBe("HTTP 418");
    expect(mapHttpError(404, "").message).toBe("Resource not found");
  });

  test("long messages are clipped", () => {
    const err = mapHttpError(500, JSON.stringify({ message: "x".repeat(1000) }));
    expect(err.message.length).toBe(300);
    expect(err.message.endsWith("…")).toBe(true);
  });

  test("gateway statuses are the only 'unreachable' ones", () => {
    for (const s of [502, 503, 504]) expect(mapHttpError(s, "").kind).toBe("unreachable");
  });
});

describe("connectionError recognises Bun's connection failures", () => {
  const SOCK = "/run/user/1000/podman/podman.sock";

  test("FailedToOpenSocket (Bun 1.3.10: missing, stale, denied) is unreachable and names the socket", () => {
    const e = Object.assign(new Error("Was there a typo in the url or port?"), { code: "FailedToOpenSocket" });
    const mapped = connectionError(e, SOCK);
    expect(mapped?.kind).toBe("unreachable");
    expect(mapped?.message).toBe(`Cannot connect to the Podman socket at ${SOCK}`);
  });

  test("TypeError (Bun 1.4.x) is unreachable", () => {
    expect(connectionError(new TypeError("fetch failed"), SOCK)?.kind).toBe("unreachable");
  });

  test("ECONNRESET is a lost connection", () => {
    const e = Object.assign(new Error("The socket connection was closed unexpectedly."), { code: "ECONNRESET" });
    expect(connectionError(e, SOCK)?.message).toBe(`Connection to Podman was lost (${SOCK})`);
  });

  test("anything else is not claimed", () => {
    expect(connectionError(new Error("something else"), SOCK)).toBeUndefined();
    expect(connectionError("string", SOCK)).toBeUndefined();
  });
});

describe("send over a real unix socket", () => {
  test("a 304 answer is success with changed=false (Podman's no-op reply)", async () => {
    const server = fakeUnixServer("c304", (s) => {
      s.write("HTTP/1.1 304 Not Modified\r\nConnection: close\r\n\r\n");
      s.end();
    });
    try {
      const result = await postVoid(server.path, "/containers/web/start");
      expect(result).toEqual({ changed: false });
      expect(actionResult(result).message).toContain("nothing changed");
    } finally {
      server.stop();
    }
  });

  test("a 204 answer is success with changed=true", async () => {
    const server = fakeUnixServer("c204", (s) => {
      s.write("HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
      s.end();
    });
    try {
      const result = await postVoid(server.path, "/containers/web/stop");
      expect(result).toEqual({ changed: true });
      expect(actionResult(result)).toEqual({ success: true });
    } finally {
      server.stop();
    }
  });

  test("the timeout covers the body: a server that stalls mid-body times out", async () => {
    // Headers and the first chunk arrive, then nothing. The old code cleared
    // the timer on headers, so this call hung forever.
    const server = fakeUnixServer("stall", (s) => {
      s.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n5\r\n[1,2,\r\n");
    });
    const started = Date.now();
    try {
      await get(server.path, "/containers/json", { timeout: 400 });
      throw new Error("expected a timeout");
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      expect((e as EngineError).message).toBe("Request timeout after 400ms");
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      server.stop();
    }
  }, 15000);

  test("a server that drops the connection mid-body reports a lost connection", async () => {
    const server = fakeUnixServer("reset", (s) => {
      s.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n5\r\n[1,2,\r\n");
      setTimeout(() => s.end(), 50);
    });
    try {
      await get(server.path, "/containers/json");
      throw new Error("expected a failure");
    } catch (e) {
      expect((e as EngineError).kind).toBe("unreachable");
      expect((e as EngineError).message).toContain("lost");
    } finally {
      server.stop();
    }
  });

  test("a stream whose daemon dies mid-stream reports a lost connection", async () => {
    const server = fakeUnixServer("streset", (s) => {
      s.write("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n");
      setTimeout(() => s.end(), 50);
    });
    try {
      const chunks: Uint8Array[] = [];
      let caught: unknown;
      try {
        for await (const c of streamChunks(server.path, "/containers/x/logs")) chunks.push(c);
      } catch (e) {
        caught = e;
      }
      expect(chunks.length).toBeGreaterThan(0);
      expect((caught as EngineError).message).toContain("lost");
    } finally {
      server.stop();
    }
  });

  test("the caller's abort listener is removed after a successful request", async () => {
    const server = fakeUnixServer("listener", (s) => {
      s.write(httpResponse(200, "OK", "[]"));
      s.end();
    });
    const controller = new AbortController();
    const signal = controller.signal;
    let added = 0;
    let removed = 0;
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = ((...args: Parameters<typeof add>) => { added++; add(...args); }) as typeof add;
    signal.removeEventListener = ((...args: Parameters<typeof remove>) => { removed++; remove(...args); }) as typeof remove;
    try {
      await get(server.path, "/containers/json", { signal });
      expect(added).toBe(1);
      expect(removed).toBe(1);
    } finally {
      server.stop();
    }
  });
});

describe.skipIf(!process.env["PODTUI_INTEGRATION"])("against the sandbox (live statuses)", () => {
  const SOCKET = "/tmp/podtui-dev/podman.sock";
  const engine = createPodmanEngine();

  test("starting the running `web` container is a no-op success, not an error", async () => {
    const result = await engine.startContainer(SOCKET, "web");
    expect(result.success).toBe(true);
    expect(result.message).toContain("nothing changed");
  });

  test("removing a running container without force explains why it failed", async () => {
    assertSandboxSocket(SOCKET);
    try {
      await engine.removeContainer(SOCKET, "chatty", false);
      throw new Error("expected Podman to refuse");
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      expect((e as EngineError).kind).toBe("unknown");
      expect((e as EngineError).message).toContain("running");
    }
  });

  test("inspecting a missing container says which one", async () => {
    try {
      await engine.inspectContainer(SOCKET, "no-such-container");
      throw new Error("expected 404");
    } catch (e) {
      expect((e as EngineError).kind).toBe("notFound");
      expect((e as EngineError).message).toContain("no-such-container");
    }
  });
});
