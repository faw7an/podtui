import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KEYMAP } from "../src/ui/view/help.ts";
import { USAGE } from "../src/cli.ts";
import { DEFAULT_POLL_MS, MAX_POLL_MS, MIN_POLL_MS } from "../src/config.ts";
import { socketCandidates } from "../src/api/socket.ts";

/**
 * The README documents behaviour that lives in code. These tests fail when
 * the two drift, the same way the help overlay is tied to KEYMAP (P8-T2).
 */

const ROOT = join(import.meta.dirname, "..");
const README = readFileSync(join(ROOT, "README.md"), "utf8");

describe("README stays in sync with the code", () => {
  test("every key binding is documented with its description", () => {
    for (const { key, desc } of KEYMAP) {
      expect(README).toContain(`| \`${key}\` | ${desc} |`);
    }
  });

  test("documents every CLI flag the parser accepts", () => {
    for (const flag of ["--socket", "--version", "-v", "--help", "-h"]) {
      expect(USAGE).toContain(flag);
      expect(README).toContain(`\`${flag}`);
    }
  });

  test("refresh interval default and limits match src/config.ts", () => {
    expect(README).toContain(`default ${DEFAULT_POLL_MS}, clamped to ${MIN_POLL_MS}–${MAX_POLL_MS}`);
  });

  test("the socket discovery table lists the sources in the order the code checks them", () => {
    const order = socketCandidates("/cli.sock", {
      XDG_RUNTIME_DIR: "/run/user/1",
      PODTUI_SOCKET: "/env.sock",
      CONTAINER_HOST: "unix:///ch.sock",
      DOCKER_HOST: "unix:///dh.sock",
    }).map((c) => c.source);
    const rows = [...README.matchAll(/^\| (\d) \| (.+?) \|/gm)].map((m) => m[2]!);
    const labels: Record<string, string> = {
      "--socket": "`--socket <path>`",
      PODTUI_SOCKET: "`PODTUI_SOCKET`",
      CONTAINER_HOST: "`CONTAINER_HOST`",
      DOCKER_HOST: "`DOCKER_HOST`",
      "rootless Podman": "`$XDG_RUNTIME_DIR/podman/podman.sock`",
      "rootful Podman": "`/run/podman/podman.sock`",
    };
    const expected = order.map((source, i) =>
      source === "podman-docker link"
        ? (i === order.length - 1 ? "`/run/docker.sock`" : "`$XDG_RUNTIME_DIR/docker.sock`")
        : labels[source],
    );
    expect(rows).toEqual(expected as string[]);
  });

  test("the install URL points at the repository install.sh downloads from", () => {
    const script = readFileSync(join(ROOT, "install.sh"), "utf8");
    const repo = /REPO="\$\{PODTUI_REPO:-([^}]+)\}"/.exec(script)?.[1];
    expect(repo).toBeTruthy();
    expect(README).toContain(`https://raw.githubusercontent.com/${repo}/main/install.sh`);
    expect(README).toContain(`https://github.com/${repo}/releases`);
  });
});
