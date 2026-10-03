/**
 * CLI flag parsing for the entry point (`src/index.tsx`).
 *
 * This is the `--socket` half of P8-T1 and nothing more: `--version` would need
 * to read package.json at runtime (absent next to a compiled binary) and
 * `--debug` needs log-file plumbing that does not exist yet, so both stay
 * future work rather than half-implemented flags.
 *
 * `parseArgs` takes an already-sliced argv — no node/bun prefix, no script
 * name — so it is a pure function and unit-testable without spawning anything.
 */

export interface CliArgs {
  /** Explicit `--socket` value, if given. Otherwise `discoverSocket()` decides. */
  socket?: string;
  help: boolean;
}

export type ParseResult = { ok: true; args: CliArgs } | { ok: false; error: string };

export const USAGE = `podtui - terminal UI for Podman

Usage:
  podtui [--socket <path>] [--help]

Options:
  --socket <path>  Podman socket to connect to.
                   Falls back to PODTUI_SOCKET, then the standard
                   rootless ($XDG_RUNTIME_DIR/podman/podman.sock)
                   and rootful (/run/podman/podman.sock) locations.
  --help, -h       Print this message and exit.
`;

export function parseArgs(argv: string[]): ParseResult {
  const args: CliArgs = { help: false };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (token === "--help" || token === "-h") {
      args.help = true;
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