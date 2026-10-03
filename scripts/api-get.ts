/**
 * Fetch one endpoint from the Podman API over a unix socket and write the raw
 * body to stdout.
 *
 * This exists because `curl --unix-socket` does not work on this machine
 * (verified 2026-10-03: it returns HTTP:000 against a socket that a raw connect
 * proves is listening and answering 200). `scripts/record-fixtures.sh` used to
 * be built entirely on curl, so it could not record anything here.
 *
 * This is the same code path the app itself uses, which makes it the transport
 * we trust: `fetch(..., { unix })` with `http://d` as the host.
 *
 * Usage:
 *   api-get.ts <path>                 e.g. /containers/json?all=true
 *   api-get.ts <path> --duration 2000 sample a stream for 2s, then exit 0
 *
 * Exit codes: 0 on 2xx, 1 on HTTP error (body on stderr), 2 on bad usage.
 * Binary bodies are written verbatim, so multiplexed log fixtures stay intact.
 */

const BASE = "http://d/v5.0.0/libpod";

export {};

function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--"));
if (path === undefined) {
  fail("usage: api-get.ts <path> [--duration <ms>]", 2);
}
if (!path.startsWith("/")) {
  fail(`path must start with "/" (got "${path}")`, 2);
}

const durationIndex = args.indexOf("--duration");
const durationMs = durationIndex === -1 ? 0 : Number(args[durationIndex + 1]);
if (durationIndex !== -1 && !Number.isFinite(durationMs)) {
  fail("--duration needs a number of milliseconds", 2);
}

const socketPath = process.env["PODTUI_SOCKET"] ?? "/tmp/podtui-dev/podman.sock";

const response = await fetch(`${BASE}${path}`, { unix: socketPath } as never).catch((e: unknown) => {
  fail(`cannot reach ${socketPath}: ${e instanceof Error ? e.message : String(e)}`, 1);
});

if (!response.ok) {
  const body = await response.text();
  fail(`HTTP ${response.status} for ${path}: ${body.slice(0, 300)}`, 1);
}

if (durationMs > 0) {
  // Streaming sample: copy bytes for a fixed window, then exit cleanly. A stream
  // is expected to stay open, so a timeout here is success, not failure.
  const reader = response.body?.getReader();
  if (!reader) process.exit(0);
  const deadline = Date.now() + durationMs;
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const next = reader.read();
      const timeout = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), remaining)
      );
      const result = await Promise.race([next, timeout]);
      if (result === null || result.done) break;
      process.stdout.write(result.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  process.exit(0);
}

process.stdout.write(Buffer.from(await response.arrayBuffer()));