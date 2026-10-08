/**
 * systemd access for quadlets (P6): unit state, actions, unit text and the
 * journal, through `systemctl` / `journalctl`. No React here (engine layer).
 *
 * Verified on this machine (systemd 259):
 * - `systemctl [--user] show A B -p Id,LoadState,ActiveState,SubState` prints
 *   one `Key=Value` block per unit, separated by a blank line, exit 0 even
 *   for unknown units (`LoadState=not-found`). Fixture `systemctl-show.txt`.
 * - `journalctl [--user] -u U -o json --no-pager` prints one JSON object per
 *   line with `MESSAGE`, `PRIORITY` (syslog 0-7, as a string) and
 *   `__REALTIME_TIMESTAMP` (µs since epoch, string); nothing and exit 0 for an
 *   unknown unit. Fixture `journal-user-unit.jsonl` (trimmed).
 *
 * Scope: a rootless Podman socket means the USER manager (`--user`); a rootful
 * one the system manager. `Info.host.security.rootless` decides.
 *
 * Commands go through an injectable runner, so tests never spawn the real
 * systemctl (and never touch the user's real systemd).
 */

export type SystemdScope = "user" | "system";

export interface CommandResult {
  code: number;
  out: string;
  err: string;
}

export interface CommandRunner {
  run(argv: string[], opts?: { timeoutMs?: number }): Promise<CommandResult>;
  /** Stream stdout lines until the command ends or `signal` aborts it. */
  lines(argv: string[], signal: AbortSignal): AsyncGenerator<string>;
}

const scopeFlag = (scope: SystemdScope): string[] => (scope === "user" ? ["--user"] : []);

export interface UnitState {
  id: string;
  load: string;
  active: string;
  sub: string;
}

/** Parse `systemctl show … -p Id,LoadState,ActiveState,SubState` output. */
export function parseSystemctlShow(text: string): Map<string, UnitState> {
  const out = new Map<string, UnitState>();
  for (const block of text.split(/\n\s*\n/)) {
    const kv = new Map<string, string>();
    for (const line of block.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) kv.set(line.slice(0, eq), line.slice(eq + 1));
    }
    const id = kv.get("Id");
    if (!id) continue;
    out.set(id, {
      id,
      load: kv.get("LoadState") ?? "",
      active: kv.get("ActiveState") ?? "",
      sub: kv.get("SubState") ?? "",
    });
  }
  return out;
}

/** "active (running)", "inactive (dead)", "not loaded"… for display. */
export function describeState(s: UnitState | undefined): string {
  if (!s) return "unknown";
  if (s.load === "not-found") return "not loaded";
  return s.sub && s.sub !== s.active ? `${s.active} (${s.sub})` : s.active;
}

function failed(what: string, r: CommandResult): Error {
  const msg = (r.err || r.out).trim().split("\n").slice(-3).join(" ").trim();
  return new Error(msg ? `${what}: ${msg}` : `${what} failed (exit ${r.code})`);
}

export async function unitStates(runner: CommandRunner, scope: SystemdScope, units: string[]): Promise<Map<string, UnitState>> {
  if (units.length === 0) return new Map();
  const r = await runner.run(["systemctl", ...scopeFlag(scope), "show", ...units, "-p", "Id,LoadState,ActiveState,SubState"], { timeoutMs: 5000 });
  if (r.code !== 0) throw failed("systemctl show", r);
  return parseSystemctlShow(r.out);
}

export type UnitVerb = "start" | "stop" | "restart";

export async function unitAction(runner: CommandRunner, scope: SystemdScope, verb: UnitVerb, unit: string): Promise<void> {
  // systemd's own timeouts govern how long a stop may take; this bound only
  // keeps a hung systemctl from hanging the UI forever.
  const r = await runner.run(["systemctl", ...scopeFlag(scope), verb, unit], { timeoutMs: 120_000 });
  if (r.code !== 0) throw failed(`systemctl ${verb} ${unit}`, r);
}

/** Make systemd re-run the quadlet generator after quadlet files changed. */
export async function daemonReload(runner: CommandRunner, scope: SystemdScope): Promise<void> {
  const r = await runner.run(["systemctl", ...scopeFlag(scope), "daemon-reload"], { timeoutMs: 60_000 });
  if (r.code !== 0) throw failed("systemctl daemon-reload", r);
}

/** `systemctl cat` (the generated unit) + `systemctl status` for the Unit tab. */
export async function unitText(runner: CommandRunner, scope: SystemdScope, unit: string): Promise<{ cat: string; status: string }> {
  const [cat, status] = await Promise.all([
    runner.run(["systemctl", ...scopeFlag(scope), "cat", "--no-pager", unit], { timeoutMs: 5000 }),
    // `status` exits 3 for an inactive unit and 4 for an unknown one: both are
    // answers, not failures, so its text is shown whatever the code.
    runner.run(["systemctl", ...scopeFlag(scope), "status", "--no-pager", "--lines=0", unit], { timeoutMs: 5000 }),
  ]);
  return {
    cat: cat.code === 0 ? cat.out : (cat.err || cat.out).trim() || `No unit file for ${unit} (is systemd reloaded?)`,
    status: (status.out || status.err).trimEnd(),
  };
}

export interface JournalEntry {
  timestamp: Date;
  message: string;
  /** syslog priority 0-7; 3 and below are errors, 4 a warning. */
  priority: number;
}

/** One `journalctl -o json` line; null for anything unreadable. */
export function parseJournalLine(line: string): JournalEntry | null {
  if (line.trim() === "") return null;
  let j: { MESSAGE?: unknown; PRIORITY?: unknown; __REALTIME_TIMESTAMP?: unknown };
  try {
    j = JSON.parse(line);
  } catch {
    return null;
  }
  // journald encodes non-UTF-8 messages as a byte array.
  const message = Array.isArray(j.MESSAGE)
    ? new TextDecoder().decode(new Uint8Array(j.MESSAGE as number[]))
    : typeof j.MESSAGE === "string"
      ? j.MESSAGE
      : "";
  const us = Number(j.__REALTIME_TIMESTAMP);
  const priority = Number(j.PRIORITY);
  return {
    timestamp: Number.isFinite(us) ? new Date(us / 1000) : new Date(),
    message,
    priority: Number.isFinite(priority) ? priority : 6,
  };
}

/** Follow a unit's journal (last `lines`, then live). Abort `signal` to stop. */
export async function* followJournal(
  runner: CommandRunner,
  scope: SystemdScope,
  unit: string,
  signal: AbortSignal,
  lines = 200,
): AsyncGenerator<JournalEntry> {
  const argv = ["journalctl", ...scopeFlag(scope), "-u", unit, "-f", "-n", String(lines), "-o", "json", "--no-pager"];
  for await (const line of runner.lines(argv, signal)) {
    const entry = parseJournalLine(line);
    if (entry) yield entry;
  }
}

/** The real runner, on Bun.spawn. */
export const bunRunner: CommandRunner = {
  async run(argv, opts = {}) {
    const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const timer = setTimeout(() => proc.kill(), opts.timeoutMs ?? 10_000);
    try {
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code, out, err };
    } finally {
      clearTimeout(timer);
    }
  },
  async *lines(argv, signal) {
    const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const kill = (): void => proc.kill();
    if (signal.aborted) kill();
    else signal.addEventListener("abort", kill, { once: true });
    const decoder = new TextDecoder();
    let buf = "";
    try {
      const reader = proc.stdout.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          yield buf.slice(0, i);
          buf = buf.slice(i + 1);
        }
      }
      if (buf) yield buf;
    } finally {
      signal.removeEventListener("abort", kill);
      proc.kill();
    }
  },
};
