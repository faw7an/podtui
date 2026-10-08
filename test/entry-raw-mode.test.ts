import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fakeUnixServer, httpResponse, type FakeServer } from "./helpers/unixServer.ts";
import * as path from "node:path";

/**
 * R-03: running the app with a non-TTY stdin must fail loudly and honestly.
 *
 * Before this, `echo | podtui` printed Ink's raw-mode error *plus a React stack
 * trace* and then **exited 0** — a failed run reported success, which breaks
 * any script or CI step that checks the exit code. Ink's own condition for raw
 * mode is `stdin.isTTY` (node_modules/ink/build/components/App.js:121), so that
 * is exactly what the entry point checks before rendering.
 */

const ROOT = path.join(import.meta.dirname, "..");
const ENTRY = path.join(ROOT, "src", "index.tsx");

/**
 * Discovery must succeed for the entry to reach the TTY gate. A fake Podman
 * that answers the probe keeps these tests independent of the dev sandbox
 * (they failed whenever it was down).
 */
let fakePodman: FakeServer;
beforeAll(() => {
  fakePodman = fakeUnixServer("rawmode", (s) => {
    s.write(httpResponse(200, "OK", "OK", "text/plain"));
    s.end();
  });
});
afterAll(() => fakePodman.stop());

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function runEntry(stdin: "pipe" | "ignore"): Promise<RunResult> {
  const proc = Bun.spawn(["bun", ENTRY], {
    cwd: ROOT,
    stdin,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PODTUI_SOCKET: fakePodman.path },
  });
  proc.stdin?.end();
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

describe("entry point: stdin must be a TTY", () => {
  test("exits non-zero instead of reporting success", async () => {
    const result = await runEntry("pipe");
    expect(result.code).not.toBe(0);
    expect(result.code).toBe(1);
  });

  test("explains the problem in one readable line, on stderr", async () => {
    const result = await runEntry("pipe");
    expect(result.stderr).toContain("terminal");
    expect(result.stderr.trim().split("\n").length).toBeLessThanOrEqual(4);
  });

  test("shows no React stack trace", async () => {
    const result = await runEntry("pipe");
    expect(result.stderr).not.toContain("react_stack_bottom");
    expect(result.stderr).not.toContain("node_modules/react-reconciler");
    expect(result.stderr).not.toContain("node_modules/ink/build");
    // Ink's own message leaked through in the pre-fix run; it must not any more.
    expect(result.stderr).not.toContain("Raw mode is not supported");
  });

  test("renders nothing to stdout when it refuses to start", async () => {
    const result = await runEntry("pipe");
    expect(result.stdout).toBe("");
  });

  test("behaves the same with stdin closed entirely", async () => {
    const result = await runEntry("ignore");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("terminal");
  });
});