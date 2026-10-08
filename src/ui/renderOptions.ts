import type { RenderOptions } from "ink";

/**
 * Options for the app's single `render()` call.
 *
 * `interactive` is decided by whether stdout is a terminal, never by CI
 * detection. Ink's default is `!isInCi && stdout.isTTY` (ink/build/ink.js),
 * and in non-interactive mode it writes ONLY the final frame, at exit — and
 * the alternate screen also requires interactive mode. So anyone with `CI`
 * set in their shell (dev containers commonly do) got a blank screen until
 * they quit. Found when GitHub Actions (CI=true) blanked every Ink test.
 * podtui is a full-screen TUI: if stdout is a terminal, it is interactive.
 *
 * `alternateScreen` keeps scrollback clean and restores the previous screen
 * on exit; Ink performs the enter/exit and cursor restore itself.
 */
export function appRenderOptions(stdout: { isTTY?: boolean }): RenderOptions {
  return {
    alternateScreen: true,
    interactive: stdout.isTTY === true,
  };
}
