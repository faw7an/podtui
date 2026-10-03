import { render } from "ink";
import { App } from "./ui/App.tsx";
import { USAGE, parseArgs } from "./cli.ts";
import { discoverSocket } from "./api/socket.ts";

/**
 * `alternateScreen: true` keeps scrollback clean and restores the previous
 * screen on exit. Ink performs the enter/exit sequences and the cursor
 * restore itself, symmetrically, including on unmount — verified in
 * docs/DECISIONS.md, so we do not hand-roll the escapes.
 */

// Flag parsing comes first so `--help` works even when stdin is a pipe.
const parsed = parseArgs(process.argv.slice(2));
if (!parsed.ok) {
  process.stderr.write(`${parsed.error}\n\n${USAGE}`);
  process.exit(1);
}
if (parsed.args.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

// The socket is resolved here, once, instead of inside the UI: `--socket`,
// then PODTUI_SOCKET, then the standard rootless and rootful locations. The
// old hardcoded sandbox fallback is gone — `bun run dev` sets PODTUI_SOCKET
// via package.json, and a compiled binary on a real machine now finds the
// real daemon instead of looking only at /tmp.
const socket = discoverSocket(parsed.args.socket);
if (socket.kind === "unreachable") {
  process.stderr.write(`${socket.message}\n${socket.fixCommand}\n`);
  process.exit(1);
}

/**
 * Refuse to start without a TTY, before Ink renders anything.
 *
 * Ink decides raw-mode support the same way (`stdin.isTTY`, see
 * node_modules/ink/build/components/App.js:121) and otherwise throws from
 * inside a React effect. That surfaced as Ink's raw-mode message followed by a
 * React stack trace, and the process still exited **0** — a failed run reported
 * success, which silently breaks any script that checks the exit code.
 */
if (!process.stdin.isTTY) {
  process.stderr.write(
    "podtui needs an interactive terminal: stdin is not a TTY, so keyboard input cannot be read.\n" +
      "Run podtui directly in a terminal, not through a pipe, pager or CI capture.\n",
  );
  process.exit(1);
}

render(<App socketPath={socket.path} />, { alternateScreen: true });