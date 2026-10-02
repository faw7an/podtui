import { existsSync } from "node:fs";

export type SocketResult =
  | { kind: "found"; path: string }
  | { kind: "unreachable"; message: string; fixCommand: string };

export function getXDGRuntimeDir(): string {
  if (process.env["XDG_RUNTIME_DIR"]) {
    return process.env["XDG_RUNTIME_DIR"]!;
  }
  const uid = process.getuid?.() ?? 1000;
  return `/run/user/${uid}`;
}

export function discoverSocket(cliSocket?: string): SocketResult {
  const candidates: string[] = [];

  if (cliSocket) {
    candidates.push(cliSocket);
  }

  if (process.env["PODTUI_SOCKET"]) {
    candidates.push(process.env["PODTUI_SOCKET"]!);
  }

  candidates.push(`${getXDGRuntimeDir()}/podman/podman.sock`);
  candidates.push("/run/podman/podman.sock");

  for (const path of candidates) {
    if (existsSync(path)) {
      return { kind: "found", path };
    }
  }

  const fixCommand = `systemctl --user enable --now podman.socket`;
  return {
    kind: "unreachable",
    message: "Podman socket not found. Is podman.socket running?",
    fixCommand,
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
    };
  }
  return discovered;
}