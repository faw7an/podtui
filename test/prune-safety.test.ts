import { test, expect, describe, beforeAll } from "bun:test";
import { createPodmanEngine } from "../src/engine/podman.ts";
import { findAndPingSocket } from "../src/api/socket.ts";

/**
 * R-04 regression tests: a prune PREVIEW must never destroy anything.
 *
 * The libpod prune endpoints take no parameters, so the previous
 * `{dryRun:true}` request body was silently ignored and the prune really ran.
 * These tests pin the behaviour down: preview calls are read-only, and they
 * report what the matching CLI prune would actually remove.
 */

const SOCKET_PATH = "/tmp/podtui-dev/podman.sock";
const engine = createPodmanEngine();

/** Guard from AGENTS.md §3: destructive tests may only touch the sandbox. */
export function assertSandboxSocket(socketPath: string): void {
  if (!socketPath.startsWith("/tmp/podtui-dev/") && !socketPath.startsWith("/tmp/podtui-test/")) {
    throw new Error(
      `Refusing to run a destructive integration test against ${socketPath}: ` +
        `only /tmp/podtui-dev and /tmp/podtui-test are allowed.`,
    );
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

async function containers(): Promise<{ name: string; state: string }[]> {
  const list = await engine.listContainers(SOCKET_PATH, true);
  return list.map((c) => ({ name: c.Names?.[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12), state: c.State }));
}

async function containerNames(): Promise<Set<string>> {
  return new Set((await containers()).map((c) => c.name));
}

/**
 * `podman run -d ... true` returns before Podman has reaped the process, so the
 * container can still read `running` for a moment. The preview contract is
 * "reports everything that is not running", so the fixture must actually be
 * stopped before we assert on it.
 */
async function waitUntilStopped(name: string, timeoutMs = 10000): Promise<string> {
  const start = Date.now();
  for (;;) {
    const found = (await containers()).find((c) => c.name === name);
    if (found && found.state.toLowerCase() !== "running") return found.state;
    if (Date.now() - start > timeoutMs) throw new Error(`${name} never left the running state`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("R-04: prune previews are read-only", () => {
  beforeAll(async () => {
    if (!process.env["PODTUI_INTEGRATION"]) {
      console.log("Skipping integration tests (set PODTUI_INTEGRATION=1 to run)");
      return;
    }
    assertSandboxSocket(SOCKET_PATH);
    const result = await findAndPingSocket(SOCKET_PATH);
    if (result.kind === "unreachable") {
      throw new Error(`Sandbox not reachable: ${result.message}`);
    }
  });

  test("container preview lists stopped containers and deletes nothing", async () => {
    if (!process.env["PODTUI_INTEGRATION"]) return;
    assertSandboxSocket(SOCKET_PATH);

    const victim = "audit-preview-victim";
    await podman(["rm", "-f", victim]).catch(() => undefined);
    await podman([
      "run", "-d",
      "--name", victim,
      "--label", "podtui.test=1",
      "docker.io/library/alpine:latest", "true",
    ]);

    try {
      // `podman run -d ... true` returns before Podman reaps the process, so
      // the list still reports `running` for a moment. The preview contract is
      // "everything that is not running", so wait for the fixture to actually
      // stop first (observed labels: "stopped" then "exited").
      const state = await waitUntilStopped(victim);
      expect(state.toLowerCase()).not.toBe("running");
      expect(["exited", "stopped", "created"]).toContain(state.toLowerCase());
      expect((await containerNames()).has(victim)).toBe(true);

      const preview = await engine.pruneContainers(SOCKET_PATH, true);

      // The preview must report the stopped container...
      expect(preview.containers?.count).toBeGreaterThanOrEqual(1);
      expect(preview.containers?.names).toContain(victim);
      // ...and must NOT have removed it. This assertion is the regression: it
      // fails against the old `{dryRun:true}` implementation.
      const after = await containerNames();
      expect(after.has(victim)).toBe(true);
    } finally {
      await podman(["rm", "-f", victim]).catch(() => undefined);
    }
  }, 60000);

  test("container preview matches `podman ps --filter status=exited`", async () => {
    if (!process.env["PODTUI_INTEGRATION"]) return;
    assertSandboxSocket(SOCKET_PATH);

    // Valid `--filter status=` values, verified against `podman ps --filter`
    // on 6.1.1 ("dead" is rejected: "unknown container state: dead").
    const NON_RUNNING_STATES = ["created", "exited", "paused", "stopping", "stopped", "initialized", "unknown"];
    const names = new Set<string>();
    for (const state of NON_RUNNING_STATES) {
      const cli = await podman(["ps", "-a", "--filter", `status=${state}`, "--format", "{{.Names}}"]);
      for (const line of cli.split("\n")) {
        const n = line.trim();
        if (n.length > 0) names.add(n);
      }
    }
    const cliNames = [...names].sort();

    const preview = await engine.pruneContainers(SOCKET_PATH, true);
    const previewNames = [...(preview.containers?.names ?? [])].sort();

    // The sandbox `failing` container may or may not exist depending on when
    // the suite runs, so compare the sets rather than a fixed expectation.
    expect(previewNames).toEqual(cliNames.sort());
  }, 60000);

  test("image preview lists dangling images and deletes nothing", async () => {
    if (!process.env["PODTUI_INTEGRATION"]) return;
    assertSandboxSocket(SOCKET_PATH);

    const before = await engine.listImages(SOCKET_PATH, true);
    const beforeIds = before.map((i) => i.Id).sort();

    const preview = await engine.pruneImages(SOCKET_PATH, true);

    // Everything tagged is in use or referenced, so nothing is dangling here;
    // what matters is that the tagged images are NOT reported as prunable.
    const danglingIds = before.filter((i) => (i.RepoTags ?? []).length === 0).map((i) => i.Id);
    expect(preview.images?.count ?? 0).toBe(danglingIds.length);

    const after = await engine.listImages(SOCKET_PATH, true);
    expect(after.map((i) => i.Id).sort()).toEqual(beforeIds);
  }, 60000);

  test("volume preview lists unused volumes and deletes nothing", async () => {
    if (!process.env["PODTUI_INTEGRATION"]) return;
    assertSandboxSocket(SOCKET_PATH);

    // `podman volume prune` (no --all) removes only ANONYMOUS unused volumes,
    // and the sandbox only has the named `test-volume`, so the correct preview
    // is empty. It must at least never claim the named volume is prunable.
    const before = await engine.listVolumes(SOCKET_PATH);
    const ANON = /^[0-9a-f]{64}$/;
    const wouldPrune = before
      .filter((v) => (v.MountCount ?? 0) === 0 && ANON.test(v.Name))
      .map((v) => v.Name)
      .sort();

    const preview = await engine.pruneVolumes(SOCKET_PATH, true);
    expect([...(preview.volumes?.names ?? [])].sort()).toEqual(wouldPrune);
    expect(preview.volumes?.names ?? []).not.toContain("test-volume");

    const after = await engine.listVolumes(SOCKET_PATH);
    expect(after.map((v) => v.Name).sort()).toEqual(before.map((v) => v.Name).sort());
  }, 60000);

  test("network preview lists networks with no attached containers", async () => {
    if (!process.env["PODTUI_INTEGRATION"]) return;
    assertSandboxSocket(SOCKET_PATH);

    const before = await engine.listNetworks(SOCKET_PATH);
    const beforeNames = before.map((n) => n.name).sort();

    const preview = await engine.pruneNetworks(SOCKET_PATH, true);

    // Cross-check against each network's inspect `containers` map, which is
    // the only place attachment data exists (the list response has none).
    const inUse: string[] = [];
    for (const n of before) {
      const detail = await engine.inspectNetwork(SOCKET_PATH, n.name);
      if (Object.keys(detail.containers ?? {}).length > 0) inUse.push(n.name);
    }
    expect([...(preview.networks?.names ?? [])].sort())
      .toEqual(before.filter((n) => !inUse.includes(n.name)).map((n) => n.name).sort());
    for (const name of inUse) {
      expect(preview.networks?.names ?? []).not.toContain(name);
    }

    const after = await engine.listNetworks(SOCKET_PATH);
    expect(after.map((n) => n.name).sort()).toEqual(beforeNames);
  }, 60000);
});

describe("assertSandboxSocket guard", () => {
  test("accepts sandbox paths", () => {
    expect(() => assertSandboxSocket("/tmp/podtui-dev/podman.sock")).not.toThrow();
    expect(() => assertSandboxSocket("/tmp/podtui-test/podman.sock")).not.toThrow();
  });

  test("rejects production and custom sockets", () => {
    expect(() => assertSandboxSocket("/run/user/1000/podman/podman.sock")).toThrow();
    expect(() => assertSandboxSocket("/run/podman/podman.sock")).toThrow();
    expect(() => assertSandboxSocket("/custom/path.sock")).toThrow();
    // A path that merely *contains* the sandbox dir must not slip through.
    expect(() => assertSandboxSocket("/etc/tmp/podtui-dev/podman.sock")).toThrow();
  });
});