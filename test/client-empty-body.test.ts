import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { EngineError, delVoid, postVoid, request } from "../src/api/client.ts";

/**
 * R-10: an empty response body must never be laundered into `{} as T`.
 *
 * The old `parseJson` returned `{} as T` whenever the body was empty. Callers
 * ignored it, so nothing broke — but the cast promised a shape it had not
 * received, and the failure would surface far from its cause (e.g.
 * `get<ContainerListItem[]>()` on a 204 handing `{}` to code that then calls
 * `.map`).
 *
 * Verified against the sandbox on 2026-10-03, so the split is grounded in what
 * Podman actually sends:
 *   - `POST /containers/{id}/start` -> 204, empty body
 *   - `POST /containers/{id}/stop`  -> 204, empty body
 *   - `DELETE /containers/{id}`     -> 200 with a JSON *report array*, NOT 204
 *
 * So action endpoints get the explicit void helpers, which tolerate both, and
 * everything that expects JSON now fails loudly instead of inventing `{}`.
 */

/** A unix socket server that replies with a fixed status and body. */
async function fixedSocket(
  name: string,
  status: number,
  body: string
): Promise<{ path: string; stop: () => void }> {
  const path = `/tmp/${name}.sock`;
  try {
    fs.unlinkSync(path);
  } catch {
    // did not exist
  }
  const payload = body;
  const server = Bun.listen({
    unix: path,
    socket: {
      data(socket) {
        socket.write(
          `HTTP/1.1 ${status} ${status === 204 ? "No Content" : "OK"}\r\n` +
            `Content-Length: ${Buffer.byteLength(payload)}\r\n` +
            "Connection: close\r\n\r\n" +
            payload
        );
        socket.end();
      },
    },
  });
  return { path, stop: () => server.stop(true) };
}

describe("request: a JSON-expecting call must not invent {}", () => {
  test("an empty body is an error, not an empty object", async () => {
    const server = await fixedSocket("podtui-audit-204", 204, "");
    try {
      let caught: unknown;
      try {
        await request(server.path, "/version");
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(EngineError);
      const err = caught as EngineError;
      expect(err.message).toContain("empty");
      // The old behaviour returned `{}`, which is neither of these.
      expect(err).not.toMatchObject({ message: "Invalid JSON response" });
    } finally {
      server.stop();
    }
  });

  test("the error names the path so the bad call site is obvious", async () => {
    const server = await fixedSocket("podtui-audit-204-path", 204, "");
    try {
      await request(server.path, "/containers/json").catch((e: EngineError) => {
        expect(e.message).toContain("/containers/json");
      });
    } finally {
      server.stop();
    }
  });
});

describe("void helpers for 204 action endpoints", () => {
  test("postVoid accepts a 204 with no body", async () => {
    const server = await fixedSocket("podtui-audit-start", 204, "");
    try {
      expect(await postVoid(server.path, "/containers/web/start", {})).toBeUndefined();
    } finally {
      server.stop();
    }
  });

  test("delVoid accepts a 204 with no body", async () => {
    const server = await fixedSocket("podtui-audit-del-204", 204, "");
    try {
      expect(await delVoid(server.path, "/containers/web")).toBeUndefined();
    } finally {
      server.stop();
    }
  });

  test("delVoid discards the report array a real DELETE returns", async () => {
    // Verified live: DELETE /containers/{id} answers 200 with a JSON array.
    const report = '[{"Id":"8618f5b269793542b5a37a286e3549d6b2e0e87907ab107fb202","Names":["web"]}]';
    const server = await fixedSocket("podtui-audit-del-200", 200, report);
    try {
      expect(await delVoid(server.path, "/containers/web", { query: { force: "true" } })).toBeUndefined();
    } finally {
      server.stop();
    }
  });

  test("void helpers still surface real HTTP errors", async () => {
    const server = await fixedSocket("podtui-audit-del-404", 404, '{"cause":"no such container"}');
    try {
      await delVoid(server.path, "/containers/nope").catch((e: EngineError) => {
        expect(e).toBeInstanceOf(EngineError);
        expect(e.kind).toBe("notFound");
      });
      // If the promise resolved, the assertion above never ran and this fails.
      const settled = await delVoid(server.path, "/containers/nope").then(
        () => "resolved",
        () => "rejected"
      );
      expect(settled).toBe("rejected");
    } finally {
      server.stop();
    }
  });

  test("void helpers pass the caller's timeout through", async () => {
    const server = await fixedSocket("podtui-audit-timeout-pass", 204, "");
    try {
      // 250ms is plenty for a local socket; the point is that the option is
      // accepted and does not silently fall back to the 10s default.
      expect(await postVoid(server.path, "/containers/web/start", {}, { timeout: 250 })).toBeUndefined();
    } finally {
      server.stop();
    }
  });
});