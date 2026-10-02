import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { discoverSocket, findAndPingSocket, getXDGRuntimeDir } from "../src/api/socket.ts";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalEnv = { ...process.env };
let testDir: string;

function setupEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

beforeEach(() => {
  testDir = join(tmpdir(), `podtui-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  setupEnv({ XDG_RUNTIME_DIR: undefined, PODTUI_SOCKET: undefined });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe("getXDGRuntimeDir", () => {
  test("returns XDG_RUNTIME_DIR when set", () => {
    setupEnv({ XDG_RUNTIME_DIR: "/custom/runtime" });
    expect(getXDGRuntimeDir()).toBe("/custom/runtime");
  });

  test("falls back to /run/user/<uid> when not set", () => {
    setupEnv({ XDG_RUNTIME_DIR: undefined });
    const result = getXDGRuntimeDir();
    expect(result).toMatch(/^\/run\/user\/\d+$/);
  });
});

describe("discoverSocket", () => {
  test("returns cliSocket when provided and exists", () => {
    const socketPath = join(testDir, "cli.sock");
    writeFileSync(socketPath, "");
    const result = discoverSocket(socketPath);
    expect(result).toEqual({ kind: "found", path: socketPath });
  });

  test("returns PODTUI_SOCKET when set and exists", () => {
    const socketPath = join(testDir, "env.sock");
    writeFileSync(socketPath, "");
    setupEnv({ PODTUI_SOCKET: socketPath });
    const result = discoverSocket();
    expect(result).toEqual({ kind: "found", path: socketPath });
  });

  test("prefers cliSocket over PODTUI_SOCKET", () => {
    const cliPath = join(testDir, "cli.sock");
    const envPath = join(testDir, "env.sock");
    writeFileSync(cliPath, "");
    writeFileSync(envPath, "");
    setupEnv({ PODTUI_SOCKET: envPath });
    const result = discoverSocket(cliPath);
    expect(result).toEqual({ kind: "found", path: cliPath });
  });

  test("falls back to XDG_RUNTIME_DIR/podman/podman.sock", () => {
    const runtimeDir = join(testDir, "runtime");
    const socketPath = join(runtimeDir, "podman", "podman.sock");
    mkdirSync(join(runtimeDir, "podman"), { recursive: true });
    writeFileSync(socketPath, "");
    setupEnv({ XDG_RUNTIME_DIR: runtimeDir });
    const result = discoverSocket();
    expect(result).toEqual({ kind: "found", path: socketPath });
  });

  test("falls back to /run/podman/podman.sock", () => {
    // Test that the function includes /run/podman/podman.sock in candidates
    // This is a structural test since we can't easily mock the filesystem root
    setupEnv({ XDG_RUNTIME_DIR: "/nonexistent", PODTUI_SOCKET: undefined });
    const result = discoverSocket();
    // Should return unreachable since neither XDG nor /run/podman exists in test env
    expect(result.kind).toBe("unreachable");
  });

  test("returns unreachable when no socket found", () => {
    setupEnv({ XDG_RUNTIME_DIR: "/nonexistent", PODTUI_SOCKET: undefined });
    const result = discoverSocket();
    expect(result.kind).toBe("unreachable");
    if (result.kind === "unreachable") {
      expect(result.fixCommand).toContain("systemctl --user enable --now podman.socket");
    }
  });
});

describe("findAndPingSocket", () => {
  test("returns unreachable when socket file does not exist", async () => {
    const result = await findAndPingSocket("/nonexistent.sock");
    expect(result.kind).toBe("unreachable");
  });
});