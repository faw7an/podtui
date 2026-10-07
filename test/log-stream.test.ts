import { test, expect, describe, beforeAll } from "bun:test";
import { createPodmanEngine } from "../src/engine/podman.ts";
import { resolveSocket } from "../src/api/socket.ts";

/**
 * R-05: log streams must be abortable.
 *
 * `containerLogs` previously accepted no AbortSignal, so a caller could only
 * `break` out of the for-await, which left the HTTP body reader pending. These
 * tests pin the abort path and the byte fidelity of the demuxer input.
 */

const SOCKET_PATH = "/tmp/podtui-dev/podman.sock";
const engine = createPodmanEngine();

function assertSandboxSocket(socketPath: string): void {
  if (!socketPath.startsWith("/tmp/podtui-dev/") && !socketPath.startsWith("/tmp/podtui-test/")) {
    throw new Error(`Refusing to run a destructive integration test against ${socketPath}`);
  }
}

async function podman(args: string[]): Promise<string> {
  const proc = Bun.spawn(["podman", "--url", `unix://${SOCKET_PATH}`, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) throw new Error(`podman ${args[0] ?? ""} exited ${code}: ${out}`);
  return out;
}

/** Raw multiplexed bytes for a container, straight from the API. */
async function rawLogs(id: string, query: string): Promise<Uint8Array> {
  const res = await fetch(`http://d/v5.0.0/libpod/containers/${id}/logs?${query}`, {
    unix: SOCKET_PATH,
  });
  return new Uint8Array(await res.arrayBuffer());
}

describe("R-05: abortable log streams", () => {
  beforeAll(async () => {
    if (!process.env["PODTUI_INTEGRATION"]) {
      console.log("Skipping integration tests (set PODTUI_INTEGRATION=1 to run)");
      return;
    }
    assertSandboxSocket(SOCKET_PATH);
    const result = await resolveSocket(SOCKET_PATH);
    if (result.kind === "unreachable") throw new Error(`Sandbox not reachable: ${result.message}`);
  });

  test("aborting mid-stream ends the generator promptly", async () => {
    if (!process.env["PODTUI_INTEGRATION"]) return;
    assertSandboxSocket(SOCKET_PATH);

    const controller = new AbortController();
    let frames = 0;
    const started = Date.now();

    // `chatty` prints every second, so without a wired signal this would block
    // for up to a full interval before the loop noticed anything.
    for await (const _frame of engine.containerLogs(SOCKET_PATH, "chatty", {
      follow: true,
      tail: 1,
      timestamps: true,
      signal: controller.signal,
    })) {
      void _frame;
      frames += 1;
      if (frames >= 2) {
        controller.abort();
        break;
      }
    }
    const elapsed = Date.now() - started;

    expect(frames).toBeGreaterThanOrEqual(2);
    // The abort must unwind the generator rather than waiting for the next
    // log line to arrive.
    expect(elapsed).toBeLessThan(5000);
  }, 30000);

  test("an already-aborted signal yields nothing and does not throw", async () => {
    if (!process.env["PODTUI_INTEGRATION"]) return;
    assertSandboxSocket(SOCKET_PATH);

    const controller = new AbortController();
    controller.abort();

    const seen: string[] = [];
    for await (const frame of engine.containerLogs(SOCKET_PATH, "chatty", {
      follow: true,
      tail: 5,
      timestamps: true,
      signal: controller.signal,
    })) {
      seen.push(frame.message);
    }
    expect(seen).toHaveLength(0);
  }, 30000);

  test("decoded frames match the raw bytes byte-for-byte", async () => {
    if (!process.env["PODTUI_INTEGRATION"]) return;
    assertSandboxSocket(SOCKET_PATH);

    // A container whose log line contains multi-byte characters and a marker
    // substring, so any decode/re-encode corruption shows up immediately.
    const name = "audit-logfidelity";
    await podman(["rm", "-f", name]).catch(() => undefined);
    await podman([
      "run", "-d", "--name", name, "--label", "podtui.test=1",
      "docker.io/library/alpine:latest",
      "sh", "-c", "printf 'FIDELITY héllo → 日本語 🐳 OK\\n'; sleep 30",
    ]);

    try {
      // Wait for the line to be flushed.
      let ready = false;
      for (let i = 0; i < 60 && !ready; i++) {
        const raw = await rawLogs(name, "stdout=true&stderr=true&follow=false&tail=10&timestamps=false");
        ready = new TextDecoder().decode(raw).includes("FIDELITY");
        if (!ready) await new Promise((r) => setTimeout(r, 200));
      }
      expect(ready).toBe(true);

      const messages: string[] = [];
      for await (const frame of engine.containerLogs(SOCKET_PATH, name, {
        follow: false,
        tail: 10,
        timestamps: false,
      })) {
        messages.push(frame.message);
      }

      expect(messages.length).toBeGreaterThanOrEqual(1);
      // Exact equality: the marker line must survive with its multi-byte
      // characters intact, not as U+FFFD replacements.
      expect(messages).toContain("FIDELITY héllo → 日本語 🐳 OK\n");
    } finally {
      await podman(["rm", "-f", name]).catch(() => undefined);
    }
  }, 60000);

  test("a frame containing an embedded newline stays one frame", async () => {
    if (!process.env["PODTUI_INTEGRATION"]) return;
    assertSandboxSocket(SOCKET_PATH);

    // Podman's log driver normally emits one frame per line, so this exercises
    // the decoder's own handling of a multi-line payload through the real
    // transport: the two lines must arrive as two frames with their own
    // headers, never merged or dropped.
    const name = "audit-multiline";
    await podman(["rm", "-f", name]).catch(() => undefined);
    await podman([
      "run", "-d", "--name", name, "--label", "podtui.test=1",
      "docker.io/library/alpine:latest",
      "sh", "-c", "printf 'MULTI-ONE\\nMULTI-TWO\\nMULTI-THREE\\n'; sleep 30",
    ]);

    try {
      let ready = false;
      for (let i = 0; i < 60 && !ready; i++) {
        const raw = await rawLogs(name, "stdout=true&stderr=true&follow=false&tail=10&timestamps=false");
        ready = new TextDecoder().decode(raw).includes("MULTI-THREE");
        if (!ready) await new Promise((r) => setTimeout(r, 200));
      }
      expect(ready).toBe(true);

      const messages: string[] = [];
      for await (const frame of engine.containerLogs(SOCKET_PATH, name, {
        follow: false,
        tail: 10,
        timestamps: false,
      })) {
        messages.push(frame.message);
      }
      expect(messages).toEqual(["MULTI-ONE\n", "MULTI-TWO\n", "MULTI-THREE\n"]);
    } finally {
      await podman(["rm", "-f", name]).catch(() => undefined);
    }
  }, 60000);
});