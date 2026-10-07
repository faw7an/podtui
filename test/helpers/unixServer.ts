import * as fs from "node:fs";
import type { Socket } from "bun";

/**
 * A scripted unix-socket HTTP server for client tests.
 *
 * Sockets live under `/tmp/podtui-test/` (short enough for the 108-byte
 * AF_UNIX path limit, and inside the tree the AGENTS.md guard allows) and are
 * UNLINKED on stop: `server.stop()` alone leaves the socket file behind, which
 * is how earlier tests littered `/tmp` with `podtui-audit-*.sock`.
 */
export interface FakeServer {
  path: string;
  stop(): void;
}

let counter = 0;

export function fakeUnixServer(
  name: string,
  onData: (socket: Socket<undefined>, request: string) => void,
): FakeServer {
  fs.mkdirSync("/tmp/podtui-test", { recursive: true });
  const path = `/tmp/podtui-test/${name}-${process.pid}-${counter++}.sock`;
  try {
    fs.unlinkSync(path);
  } catch {
    // did not exist
  }
  const server = Bun.listen<undefined>({
    unix: path,
    socket: {
      data(socket, data) {
        onData(socket, data.toString());
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
        // already gone
      }
    },
  };
}

/** A complete HTTP/1.1 response with a fixed body. */
export function httpResponse(status: number, reason: string, body = "", contentType = "application/json"): string {
  return (
    `HTTP/1.1 ${status} ${reason}\r\n` +
    `Content-Type: ${contentType}\r\n` +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    `Connection: close\r\n\r\n` +
    body
  );
}
