import { describe, expect, test } from "bun:test";
import { USAGE, parseArgs } from "../src/cli.ts";

/**
 * Socket discovery wiring: the entry point parses `--socket` and hands the
 * value to the existing `discoverSocket()` instead of `App` hardcoding the
 * sandbox path. `parseArgs` takes an already-sliced argv (no node/bun prefix,
 * no script name) so it stays a pure function.
 *
 * Deliberately narrow: `--socket` and `--help` only. `--version` would need to
 * read package.json at runtime, which breaks under `bun build --compile`, and
 * `--debug` needs log-file plumbing that does not exist yet — both stay in
 * P8-T1.
 */

function ok(argv: string[]): { socket?: string; help: boolean } {
  const result = parseArgs(argv);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.args;
}

function err(argv: string[]): string {
  const result = parseArgs(argv);
  if (result.ok) throw new Error("expected an error");
  return result.error;
}

describe("parseArgs", () => {
  test("no flags is valid and selects nothing", () => {
    expect(ok([])).toEqual({ help: false });
  });

  test("--socket takes the next token", () => {
    expect(ok(["--socket", "/run/podman/podman.sock"])).toEqual({
      socket: "/run/podman/podman.sock",
      help: false,
    });
  });

  test("--socket= takes an inline value", () => {
    expect(ok(["--socket=/tmp/custom.sock"])).toEqual({
      socket: "/tmp/custom.sock",
      help: false,
    });
  });

  test("--help sets the flag and ignores nothing else", () => {
    expect(ok(["--help"])).toEqual({ help: true });
    expect(ok(["-h"])).toEqual({ help: true });
  });

  test("a missing --socket value is an error, not an empty string", () => {
    expect(err(["--socket"])).toContain("--socket");
    expect(err(["--socket="])).toContain("--socket");
  });

  test("an unknown flag names itself and points at --help", () => {
    expect(err(["--bogus"])).toContain("--bogus");
    expect(err(["--bogus"])).toContain("--help");
  });

  test("a positional argument is an error, not silently ignored", () => {
    expect(err(["extra"])).toContain("extra");
  });

  test("a repeated --socket keeps the last value", () => {
    expect(ok(["--socket", "/a.sock", "--socket=/b.sock"]).socket).toBe("/b.sock");
  });
});

describe("USAGE", () => {
  test("documents the flags this parser accepts and the fallback order", () => {
    expect(USAGE).toContain("--socket");
    expect(USAGE).toContain("--help");
    expect(USAGE).toContain("PODTUI_SOCKET");
  });
});