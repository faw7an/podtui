/**
 * A private, disposable Podman service for tests that must run REAL
 * destructive calls (prune, remove) and compare them with what the app
 * predicted.
 *
 * Why not the dev sandbox: a real prune is global, so it would delete the
 * sandbox's seeded `failing` container, `test-volume` and `test-network` that
 * other tests and manual checks rely on.
 *
 * Isolation: storage (`--root`), run state (`--runroot`), libpod tmp state
 * (`--tmpdir`) and events (`--events-backend file`, written under tmpdir) all
 * live under `/tmp/podtui-test/<id>`. The dev sandbox script does not isolate
 * tmpdir/events; this helper does, because these tests create and destroy a
 * lot and must not leak events into the user's real `podman events`.
 *
 * Teardown removes every container first. Killing only the API service leaves
 * containers running under conmon, and rootless storage contains files owned
 * by sub-UIDs that a plain `rm -rf` cannot delete. Both were observed with the
 * old `scripts/dev-sandbox.sh down`.
 */

import { assertSandboxSocket } from "./sandboxGuard.ts";

const IMAGE = "docker.io/library/alpine:latest";
const DEV_SANDBOX = "/tmp/podtui-dev/podman.sock";

export interface ThrowawayPodman {
  socket: string;
  dir: string;
  /** Run the podman CLI against this service. Throws on a non-zero exit. */
  podman(...args: string[]): Promise<string>;
  /** Same, but returns the exit code instead of throwing. */
  podmanStatus(...args: string[]): Promise<{ code: number; out: string; err: string }>;
  stop(): Promise<void>;
}

async function run(cmd: string[]): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: out.trim(), err: err.trim() };
}

async function ping(socket: string): Promise<boolean> {
  try {
    const res = await fetch("http://d/libpod/_ping", { unix: socket } as RequestInit);
    return res.status === 200;
  } catch {
    return false;
  }
}

/** True when the podman CLI exists, so integration suites can skip cleanly. */
export function podmanAvailable(): boolean {
  return Bun.which("podman") !== null;
}

/**
 * `env` is merged into the service's environment — e.g. `XDG_CONFIG_HOME`
 * pointing at a scratch dir, so quadlet tests never read the real one.
 */
export async function startThrowawayPodman(opts: { env?: Record<string, string> } = {}): Promise<ThrowawayPodman> {
  const id = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = `/tmp/podtui-test/${id}`;
  const socket = `${dir}/podman.sock`;
  assertSandboxSocket(socket);

  const storageFlags = [
    "--root", `${dir}/root`,
    "--runroot", `${dir}/run`,
    "--tmpdir", `${dir}/tmp`,
    "--events-backend", "file",
  ];

  // The file events backend cannot follow journald logs ("using --follow with
  // the journald --log-driver but without the journald --events-backend
  // (file) is not supported"), so containers here log with k8s-file.
  const confFile = `${dir}/containers.conf`;
  await Bun.write(confFile, '[containers]\nlog_driver = "k8s-file"\n');

  const service = Bun.spawn(
    ["podman", ...storageFlags, "system", "service", "--time=0", `unix://${socket}`],
    { stdout: "ignore", stderr: "ignore", env: { ...process.env, CONTAINERS_CONF_OVERRIDE: confFile, ...opts.env } },
  );

  const deadline = Date.now() + 15_000;
  while (!(await ping(socket))) {
    if (Date.now() > deadline) {
      service.kill();
      throw new Error(`throwaway Podman at ${socket} did not come up within 15s`);
    }
    await Bun.sleep(100);
  }

  const podmanStatus = (...args: string[]) => run(["podman", "--url", `unix://${socket}`, ...args]);
  const podman = async (...args: string[]) => {
    const r = await podmanStatus(...args);
    if (r.code !== 0) throw new Error(`podman ${args.join(" ")} exited ${r.code}: ${r.err}`);
    return r.out;
  };

  // Seed the base image. Copy it from the dev sandbox when that is up (fast,
  // offline); otherwise pull it.
  if (await ping(DEV_SANDBOX)) {
    const archive = `${dir}/alpine.tar`;
    const saved = await run(["podman", "--url", `unix://${DEV_SANDBOX}`, "save", "-o", archive, IMAGE]);
    if (saved.code === 0) await podman("load", "-q", "-i", archive);
  }
  const has = await podmanStatus("image", "exists", IMAGE);
  if (has.code !== 0) await podman("pull", "-q", IMAGE);

  const stop = async () => {
    // Containers first: killing the service alone leaves them running.
    await run(["podman", ...storageFlags, "pod", "rm", "-a", "-f", "-t", "0"]);
    await run(["podman", ...storageFlags, "rm", "-a", "-f", "-t", "0"]);
    service.kill();
    await service.exited;
    // Rootless storage holds sub-UID-owned files; delete inside the user namespace.
    await run(["podman", "unshare", "rm", "-rf", dir]);
  };

  return { socket, dir, podman, podmanStatus, stop };
}

export { IMAGE as THROWAWAY_IMAGE };
