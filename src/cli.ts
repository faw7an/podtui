/**
 * CLI flag parsing for the entry point (`src/index.tsx`).
 *
 * `--socket`, `--version` and `--help` from P8-T1. `--version` reads the version
 * bundled into the binary at build time (src/version.ts). `--debug` needs
 * log-file plumbing that does not exist yet, so it stays future work rather
 * than a half-implemented flag.
 *
 * `parseArgs` takes an already-sliced argv — no node/bun prefix, no script
 * name — so it is a pure function and unit-testable without spawning anything.
 */

export interface CliArgs {
  /** Explicit `--socket` value, if given. Otherwise `resolveSocket()` decides. */
  socket?: string;
  help: boolean;
  version: boolean;
  /** `--no-mouse`: never turn on terminal mouse reporting (P7-T9). */
  noMouse: boolean;
  /** `--all`: every container on the machine, not just this folder's project. */
  all: boolean;
}

export type ParseResult = { ok: true; args: CliArgs } | { ok: false; error: string };

export const USAGE = `podtui - terminal UI for Podman

Usage:
  podtui [--all] [--socket <path>] [--no-mouse]
  podtui --version | --help

Options:
  --socket <path>  Podman socket to use (a path or a unix:// URI).
                   Without it podtui uses PODTUI_SOCKET, else the first
                   working Podman socket among: CONTAINER_HOST,
                   DOCKER_HOST (podman-docker sets it), the rootless
                   ($XDG_RUNTIME_DIR/podman/podman.sock) and rootful
                   (/run/podman/podman.sock) sockets, and podman-docker's
                   docker.sock links. A Docker daemon is never used.
  --all, -a        Show everything on this Podman. Without it, podtui shows
                   only the compose project of the current folder (the
                   containers, pods, volumes and networks it started).
  --no-mouse       Do not use the mouse (keyboard only; the terminal's own
                   text selection keeps working).
  --version, -v    Print the version and exit.
  --help, -h       Print this message and exit.
`;

export function parseArgs(argv: string[]): ParseResult {
  const args: CliArgs = { help: false, version: false, noMouse: false, all: false };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }

    if (token === "--version" || token === "-v") {
      args.version = true;
      continue;
    }

    if (token === "--all" || token === "-a") {
      args.all = true;
      continue;
    }
    if (token === "--no-mouse") {
      args.noMouse = true;
      continue;
    }
    if (token === "--socket") {
      const value = argv[i + 1];
      if (value === undefined || value === "") {
        return { ok: false, error: "--socket needs a path (got nothing after it)" };
      }
      args.socket = value;
      i++;
      continue;
    }

    if (token.startsWith("--socket=")) {
      const value = token.slice("--socket=".length);
      if (value === "") {
        return { ok: false, error: "--socket needs a path (got an empty --socket=)" };
      }
      args.socket = value;
      continue;
    }

    if (token.startsWith("-")) {
      return { ok: false, error: `Unknown flag: ${token} (see --help)` };
    }

    return { ok: false, error: `Unexpected argument: ${token} (see --help)` };
  }

  return { ok: true, args };
}