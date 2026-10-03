import { describe, expect, test } from "bun:test";
import * as path from "node:path";

/**
 * Socket discovery wiring at the entry point.
 *
 * Before this, `App` hardcoded `/tmp/podtui-dev/podman.sock`, so a compiled
 * binary on a real machine looked only at the dev sandbox path. Now
 * `src/index.tsx` resolves `--socket` → `PODTUI_SOCKET` → the standard
 * locations via `discoverSocket()` and refuses to start cleanly when nothing
 * is found. These tests spawn the real entry, like test/entry-raw-mode.test.ts.
 */

const ROOT = path.join(import.meta.dirname, "..");
const ENTRY = path.join(ROOT, "src", "index.tsx");
const SANDBOX = "/tmp/podtui-dev/podman.sock";

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function runEntry(args: string[], extraEnv: Record<string, string | undefined>): Promise<RunResult> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const proc = Bun.spawn(["bun", ENTRY, ...args], {
    cwd: ROOT,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  proc.stdin?.end();
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

const NO_SOCKET_ENV = { PODTUI_SOCKET: undefined, XDG_RUNTIME_DIR: "/nonexistent-podtui-test" };

describe("entry point: socket discovery", () => {
  test("--help works without a TTY and without any socket", async () => {
    const result = await runEntry(["--help"], NO_SOCKET_ENV);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--socket");
    expect(result.stdout).toContain("PODTUI_SOCKET");
    expect(result.stderr).toBe("");
  });

  test("an unknown flag fails with usage, not a stack trace", async () => {
    const result = await runEntry(["--bogus"], NO_SOCKET_ENV);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--bogus");
    expect(result.stderr).toContain("--help");
    expect(result.stdout).toBe("");
  });

  test("nothing found anywhere is a clean error with the fix command", async () => {
    const result = await runEntry([], NO_SOCKET_ENV);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Podman socket not found");
    expect(result.stderr).toContain("systemctl --user enable --now podman.socket");
    // The tried paths are listed, so a stale environment diagnoses itself.
    expect(result.stderr).toContain("/nonexistent-podtui-test/podman/podman.sock");
    expect(result.stderr).toContain("/run/podman/podman.sock");
    expect(result.stdout).toBe("");
  });

  test("an explicit --socket miss names its path, not the daemon default", async () => {
    const result = await runEntry(["--socket", "/nonexistent-podtui-test/x.sock"], NO_SOCKET_ENV);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("/nonexistent-podtui-test/x.sock");
    expect(result.stderr).toContain("--socket");
    expect(result.stderr).not.toContain("dev-sandbox");
  });

  test("a missing sandbox socket points at dev-sandbox.sh", async () => {
    const result = await runEntry([], {
      PODTUI_SOCKET: "/tmp/podtui-dev/missing.sock",
      XDG_RUNTIME_DIR: "/nonexistent-podtui-test",
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("/tmp/podtui-dev/missing.sock");
    expect(result.stderr).toContain("PODTUI_SOCKET");
    expect(result.stderr).toContain("scripts/dev-sandbox.sh up");
    expect(result.stdout).toBe("");
  });

  test("a valid socket still hits the TTY gate instead of rendering", async () => {
    // Proves the flag was parsed and discovery succeeded, and that the
    // no-TTY refusal from R-03 still applies after the wiring.
    const result = await runEntry(["--socket", SANDBOX], { PODTUI_SOCKET: undefined });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("not a TTY");
    expect(result.stdout).toBe("");
  });

  test("PODTUI_SOCKET alone is enough to reach the TTY gate", async () => {
    const result = await runEntry([], { PODTUI_SOCKET: SANDBOX, XDG_RUNTIME_DIR: "/nonexistent-podtui-test" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("not a TTY");
  });
});