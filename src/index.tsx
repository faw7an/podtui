import { render } from "ink";
import { App } from "./ui/App.tsx";
import { USAGE, parseArgs } from "./cli.ts";
import { VERSION } from "./version.ts";
import { appRenderOptions } from "./ui/renderOptions.ts";
import { describeUnreachable, resolveSocket } from "./api/socket.ts";
import { enableMouse } from "./input/mouse.ts";


/**
 * Render options (alternate screen, and interactive mode decided by the
 * terminal rather than CI detection) live in src/ui/renderOptions.ts.
 */

// Flag parsing comes first so `--help` and `--version` work even when stdin
// is a pipe and no Podman is running.
const parsed = parseArgs(process.argv.slice(2));
if (!parsed.ok) {
  process.stderr.write(`${parsed.error}\n\n${USAGE}`);
  process.exit(1);
}
if (parsed.args.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (parsed.args.version) {
  process.stdout.write(`podtui ${VERSION}\n`);
  process.exit(0);
}

// The socket is resolved here, once, instead of inside the UI. Order and
// rules live in src/api/socket.ts: explicit `--socket`/PODTUI_SOCKET (never
// falls back), then CONTAINER_HOST, DOCKER_HOST (podman-docker sets it), the
// rootless and rootful Podman sockets, and podman-docker's docker.sock links.
// Every candidate is checked to really be Podman, not a Docker daemon.
const socket = await resolveSocket(parsed.args.socket);
if (socket.kind === "unreachable") {
  process.stderr.write(describeUnreachable(socket));
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

// Mouse (P7-T6/T9): on unless --no-mouse; turned off again on every way
// out (see enableMouse). A terminal without mouse support simply ignores
// the request, and the keyboard works the same either way.
if (!parsed.args.noMouse) enableMouse(process.stdout);

// Plain `podtui` shows your containers from any folder; `--all` also shows
// toolbox/distrobox environments (src/engine/scope.ts).
render(
  <App socketPath={socket.path} scope={parsed.args.all ? { kind: "all" } : { kind: "mine" }} />,
  appRenderOptions(process.stdout),
);