import { statSync } from "node:fs";

/**
 * Socket discovery (FR-1), extended for podman-docker.
 *
 * Candidates, in order:
 *
 *   1. `--socket`            explicit — authoritative
 *   2. `PODTUI_SOCKET`       explicit — authoritative
 *   3. `CONTAINER_HOST`      Podman's own remote-connection variable
 *   4. `DOCKER_HOST`         set to the Podman socket by podman-docker's
 *                            /etc/profile.d/podman-docker.sh
 *   5. `$XDG_RUNTIME_DIR/podman/podman.sock`   rootless default
 *   6. `/run/podman/podman.sock`               rootful default
 *   7. `$XDG_RUNTIME_DIR/docker.sock`          podman-docker user tmpfiles link
 *   8. `/run/docker.sock`                      podman-docker system tmpfiles link
 *
 * (podman-docker's files are verified from the Arch package file list and the
 * Podman repo: `contrib/systemd/system/podman-docker.conf` is
 * `L+ %t/docker.sock - - - - %t/podman/podman.sock`, installed for both system
 * and user tmpfiles; `docker/podman-docker.sh` exports
 * `DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock`, or the rootful
 * socket for root.)
 *
 * Every candidate is PROBED with `GET /libpod/_ping`, which only Podman
 * answers: a real Docker daemon answers `/_ping` with 200 but `/libpod/_ping`
 * with 404 (verified against Docker 29.7.2 and Podman 5.8.4). Without this, a
 * machine with real Docker — or a DOCKER_HOST pointing at it — would load, and
 * every panel would then fail with "not found".
 *
 * Safety: an explicit socket (1 or 2) never falls back to another one. The dev
 * workflow points PODTUI_SOCKET at the sandbox; if the sandbox is down, the
 * old code silently continued to the user's REAL rootless socket.
 */

export type SocketSource =
  | "--socket"
  | "PODTUI_SOCKET"
  | "CONTAINER_HOST"
  | "DOCKER_HOST"
  | "rootless Podman"
  | "rootful Podman"
  | "podman-docker link";

export interface SocketCandidate {
  /** Absolute filesystem path, or the raw value when it could not be parsed. */
  path: string;
  source: SocketSource;
  /** Explicit candidates are authoritative: no fallback past them. */
  explicit: boolean;
  /** Set when the value is not a usable local unix socket (e.g. `tcp://`). */
  unsupported?: string;
}

export type CheckOutcome =
  | "podman"
  | "not found"
  | "permission denied"
  | "not a socket"
  | "Docker daemon, not Podman"
  | "no answer"
  | "unsupported";

export interface CheckedCandidate extends SocketCandidate {
  outcome: CheckOutcome;
}

export type SocketResult =
  | { kind: "found"; path: string; source: SocketSource }
  | {
      kind: "unreachable";
      message: string;
      fixCommand: string;
      /** Every candidate checked, in order, with why it was not used. */
      tried: CheckedCandidate[];
    };

type Env = Record<string, string | undefined>;

export function getXDGRuntimeDir(env: Env = process.env): string {
  const dir = env["XDG_RUNTIME_DIR"];
  if (dir) return dir;
  const uid = process.getuid?.() ?? 1000;
  return `/run/user/${uid}`;
}

/**
 * Turn a socket setting into a path. Accepts a bare absolute path or a
 * `unix://` URI (the DOCKER_HOST/CONTAINER_HOST form, `unix:///run/x.sock`).
 * Other schemes (`tcp://`, `ssh://`, `npipe://`) are not local unix sockets.
 */
export function parseSocketValue(value: string): { path: string } | { unsupported: string } {
  const trimmed = value.trim();
  if (trimmed.startsWith("unix://")) {
    const path = trimmed.slice("unix://".length);
    return path.startsWith("/") ? { path } : { unsupported: `not an absolute unix socket path: ${value}` };
  }
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
  if (scheme) return { unsupported: `${scheme[1]}:// is not supported, only local unix sockets` };
  return { path: trimmed };
}

/** The ordered, de-duplicated candidate list. Pure: no filesystem access. */
export function socketCandidates(cliSocket?: string, env: Env = process.env): SocketCandidate[] {
  const out: SocketCandidate[] = [];
  const add = (raw: string | undefined, source: SocketSource, explicit: boolean) => {
    if (raw === undefined || raw.trim() === "") return;
    const parsed = parseSocketValue(raw);
    const candidate: SocketCandidate =
      "path" in parsed
        ? { path: parsed.path, source, explicit }
        : { path: raw, source, explicit, unsupported: parsed.unsupported };
    if (out.some((c) => c.path === candidate.path)) return;
    out.push(candidate);
  };

  add(cliSocket, "--socket", true);
  add(env["PODTUI_SOCKET"], "PODTUI_SOCKET", true);
  add(env["CONTAINER_HOST"], "CONTAINER_HOST", false);
  add(env["DOCKER_HOST"], "DOCKER_HOST", false);
  const runtime = getXDGRuntimeDir(env);
  add(`${runtime}/podman/podman.sock`, "rootless Podman", false);
  add("/run/podman/podman.sock", "rootful Podman", false);
  add(`${runtime}/docker.sock`, "podman-docker link", false);
  add("/run/docker.sock", "podman-docker link", false);
  return out;
}

/** Filesystem pre-check, so a permission problem is named as one. */
export function statSocket(path: string): "ok" | "not found" | "permission denied" | "not a socket" {
  try {
    return statSync(path).isSocket() ? "ok" : "not a socket";
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "EACCES" || code === "EPERM") return "permission denied";
    return "not found";
  }
}

export type ProbeResult = "podman" | "docker" | "no answer";

const PROBE_TIMEOUT_MS = 3000;

/**
 * Ask the socket what it is. `/libpod/_ping` 200 = Podman; a 404 there but a
 * 200 on `/_ping` = a Docker-API daemon that is not Podman. Read-only GETs.
 */
export async function probeSocket(path: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeResult> {
  const ask = async (endpoint: string) => {
    const res = await fetch(`http://d${endpoint}`, {
      unix: path,
      signal: AbortSignal.timeout(timeoutMs),
    } as RequestInit);
    await res.text();
    return res.status;
  };
  try {
    if ((await ask("/libpod/_ping")) === 200) return "podman";
    return (await ask("/_ping")) === 200 ? "docker" : "no answer";
  } catch {
    return "no answer";
  }
}

export interface ResolveOptions {
  env?: Env;
  probe?: (path: string) => Promise<ProbeResult>;
  stat?: (path: string) => ReturnType<typeof statSocket>;
  isRoot?: boolean;
}

async function check(
  candidate: SocketCandidate,
  stat: NonNullable<ResolveOptions["stat"]>,
  probe: NonNullable<ResolveOptions["probe"]>,
): Promise<CheckOutcome> {
  if (candidate.unsupported) return "unsupported";
  const fs = stat(candidate.path);
  if (fs !== "ok") return fs;
  const answer = await probe(candidate.path);
  if (answer === "podman") return "podman";
  return answer === "docker" ? "Docker daemon, not Podman" : "no answer";
}

const SANDBOX_PREFIXES = ["/tmp/podtui-dev/", "/tmp/podtui-test/"];

function explicitFix(candidate: CheckedCandidate): string {
  if (SANDBOX_PREFIXES.some((p) => candidate.path.startsWith(p))) {
    return "Check the path, or start the sandbox: scripts/dev-sandbox.sh up";
  }
  switch (candidate.outcome) {
    case "Docker daemon, not Podman":
      return "Point it at a Podman socket instead (podtui uses Podman's own API).";
    case "permission denied":
      return "Check the socket's permissions, or run podtui as a user who can open it.";
    case "unsupported":
      return "Use a local unix socket path or a unix:// URI.";
    default:
      return "Check the path and make sure its service is running.";
  }
}

/**
 * Find a working Podman socket. See the module comment for order and rules.
 */
export async function resolveSocket(cliSocket?: string, options: ResolveOptions = {}): Promise<SocketResult> {
  const env = options.env ?? process.env;
  const stat = options.stat ?? statSocket;
  const probe = options.probe ?? probeSocket;
  const isRoot = options.isRoot ?? process.getuid?.() === 0;

  const candidates = socketCandidates(cliSocket, env);
  const tried: CheckedCandidate[] = [];

  // An explicit choice is authoritative: use it or stop. Never fall back.
  const explicit = candidates.find((c) => c.explicit);
  if (explicit) {
    const checked = { ...explicit, outcome: await check(explicit, stat, probe) };
    if (checked.outcome === "podman") return { kind: "found", path: checked.path, source: checked.source };
    return {
      kind: "unreachable",
      message: `No Podman at ${checked.path} (from ${checked.source}): ${checked.outcome}.`,
      fixCommand: explicitFix(checked),
      tried: [checked],
    };
  }

  for (const candidate of candidates) {
    const checked = { ...candidate, outcome: await check(candidate, stat, probe) };
    tried.push(checked);
    if (checked.outcome === "podman") return { kind: "found", path: checked.path, source: checked.source };
  }

  return {
    kind: "unreachable",
    message: "No running Podman socket found.",
    fixCommand: isRoot ? "systemctl enable --now podman.socket" : "systemctl --user enable --now podman.socket",
    tried,
  };
}

/** Human-readable report for a failed resolution (printed by the entry point). */
export function describeUnreachable(result: Extract<SocketResult, { kind: "unreachable" }>): string {
  const lines = result.tried.map((c) => `  - ${c.path} (${c.source}): ${c.outcome}`);
  return `${result.message}\nChecked:\n${lines.join("\n")}\nFix: ${result.fixCommand}\n`;
}
