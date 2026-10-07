/**
 * Guard from AGENTS.md §3: destructive tests may only touch the sandbox.
 * Prefix match on purpose — a path that merely *contains* a sandbox segment
 * (e.g. `/etc/tmp/podtui-dev/...`) must not pass.
 */
export function assertSandboxSocket(socketPath: string): void {
  if (!socketPath.startsWith("/tmp/podtui-dev/") && !socketPath.startsWith("/tmp/podtui-test/")) {
    throw new Error(
      `Refusing to run a destructive integration test against ${socketPath}: ` +
        `only /tmp/podtui-dev and /tmp/podtui-test are allowed.`,
    );
  }
}
