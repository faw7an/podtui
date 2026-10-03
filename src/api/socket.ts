import { existsSync } from "node:fs";

export type SocketResult =
  | { kind: "found"; path: string }
  | {
      kind: "unreachable";
      message: string;
      fixCommand: string;
      /** Every candidate path checked, in check order — printed on failure. */
      tried: string[];
    };

export function getXDGRuntimeDir(): string {
  if (process.env["XDG_RUNTIME_DIR"]) {
    return process.env["XDG_RUNTIME_DIR"]!;
  }
  const uid = process.getuid?.() ?? 1000;
  return `/run/user/${uid}`;
}

export function discoverSocket(cliSocket?: string): SocketResult {
  const explicit: { path: string; source: "--socket" | "PODTUI_SOCKET" }[] = [];
  if (cliSocket) {
    explicit.push({ path: cliSocket, source: "--socket" });
  }

  if (process.env["PODTUI_SOCKET"]) {
    explicit.push({ path: process.env["PODTUI_SOCKET"]!, source: "PODTUI_SOCKET" });
  }

  const tried = [
    ...explicit.map((e) => e.path),
    `${getXDGRuntimeDir()}/podman/podman.sock`,
    "/run/podman/podman.sock",
  ];

  for (const path of tried) {
    if (existsSync(path)) {
      return { kind: "found", path };
    }
  }

  // An explicit path that is missing names itself: the user pointed somewhere
  // on purpose, so the generic daemon advice would send them the wrong way.
  // The dev-sandbox hint appears only for the project's own sandbox prefixes —
  // a compiled binary must never advertise dev scripts for custom paths.
  const first = explicit[0];
  if (first) {
    const isSandbox = first.path.startsWith("/tmp/podtui-dev/") || first.path.startsWith("/tmp/podtui-test/");
    return {
      kind: "unreachable",
      message: `Podman socket not found at ${first.path} (from ${first.source}).`,
      fixCommand: isSandbox
        ? "Check the path, or start the sandbox: scripts/dev-sandbox.sh up"
        : "Check the path and make sure its service is running.",
      tried,
    };
  }

  const fixCommand = `systemctl --user enable --now podman.socket`;
  return {
    kind: "unreachable",
    message: "Podman socket not found. Is podman.socket running?",
    fixCommand,
    tried,
  };
}

export async function pingSocket(socketPath: string): Promise<boolean> {
  try {
    const res = await fetch(`http://d/_ping`, { unix: socketPath });
    return res.status === 200;
  } catch {
    return false;
  }
}

export async function findAndPingSocket(cliSocket?: string): Promise<SocketResult> {
  const discovered = discoverSocket(cliSocket);
  if (discovered.kind === "unreachable") {
    return discovered;
  }
  const reachable = await pingSocket(discovered.path);
  if (!reachable) {
    return {
      kind: "unreachable",
      message: `Podman socket at ${discovered.path} is not responding`,
      fixCommand: `systemctl --user restart podman.socket`,
      tried: [discovered.path],
    };
  }
  return discovered;
}