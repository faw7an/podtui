import { render } from "ink";
import { App } from "./ui/App.tsx";

/**
 * `alternateScreen: true` keeps scrollback clean and restores the previous
 * screen on exit. Ink performs the enter/exit sequences and the cursor
 * restore itself, symmetrically, including on unmount — verified in
 * docs/DECISIONS.md, so we do not hand-roll the escapes.
 */

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

render(<App />, { alternateScreen: true });