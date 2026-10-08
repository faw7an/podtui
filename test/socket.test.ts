import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import {
  describeUnreachable,
  getXDGRuntimeDir,
  parseSocketValue,
  probeSocket,
  resolveSocket,
  socketCandidates,
  statSocket,
  type ProbeResult,
} from "../src/api/socket.ts";
import { fakeUnixServer, httpResponse, type FakeServer } from "./helpers/unixServer.ts";

/**
 * Socket discovery (FR-1 + podman-docker). The resolve tests inject `stat`
 * and `probe` so every branch is exercised without a daemon; the probe and
 * stat functions themselves are then tested against real unix sockets, and
 * one end-to-end test reproduces the podman-docker layout (a docker.sock
 * symlink to the Podman socket) on disk.
 */

const RUNTIME = "/run/user/4242";
const ROOTLESS = `${RUNTIME}/podman/podman.sock`;
const ROOTFUL = "/run/podman/podman.sock";
const USER_DOCKER_LINK = `${RUNTIME}/docker.sock`;
const SYSTEM_DOCKER_LINK = "/run/docker.sock";
const BASE_ENV = { XDG_RUNTIME_DIR: RUNTIME };

/** A fake world: which paths exist and what answers on them. */
function world(sockets: Record<string, ProbeResult | "missing" | "denied" | "file">) {
  return {
    stat: (p: string) => {
      const v = sockets[p] ?? "missing";
      if (v === "missing") return "not found" as const;
      if (v === "denied") return "permission denied" as const;
      if (v === "file") return "not a socket" as const;
      return "ok" as const;
    },
    probe: async (p: string) => {
      const v = sockets[p];
      return v === "podman" || v === "docker" ? v : "no answer";
    },
    isRoot: false,
  };
}

describe("getXDGRuntimeDir", () => {
  test("returns XDG_RUNTIME_DIR when set", () => {
    expect(getXDGRuntimeDir({ XDG_RUNTIME_DIR: "/custom/runtime" })).toBe("/custom/runtime");
  });

  test("falls back to /run/user/<uid> when not set", () => {
    expect(getXDGRuntimeDir({})).toMatch(/^\/run\/user\/\d+$/);
  });
});

describe("parseSocketValue", () => {
  test("a bare path is used as-is", () => {
    expect(parseSocketValue("/run/podman/podman.sock")).toEqual({ path: "/run/podman/podman.sock" });
  });

  test("unix:// URIs (the DOCKER_HOST form) become paths", () => {
    expect(parseSocketValue("unix:///run/user/1000/podman/podman.sock")).toEqual({
      path: "/run/user/1000/podman/podman.sock",
    });
  });

  test("remote schemes are unsupported, not mistaken for paths", () => {
    expect(parseSocketValue("tcp://127.0.0.1:2375")).toHaveProperty("unsupported");
    expect(parseSocketValue("ssh://core@host/run/podman/podman.sock")).toHaveProperty("unsupported");
    expect(parseSocketValue("unix://relative.sock")).toHaveProperty("unsupported");
  });
});

describe("socketCandidates", () => {
  test("full order: explicit, CONTAINER_HOST, DOCKER_HOST, Podman defaults, podman-docker links", () => {
    const list = socketCandidates("/cli.sock", {
      ...BASE_ENV,
      PODTUI_SOCKET: "/env.sock",
      CONTAINER_HOST: "unix:///ch.sock",
      DOCKER_HOST: "unix:///dh.sock",
    });
    expect(list.map((c) => [c.path, c.source, c.explicit])).toEqual([
      ["/cli.sock", "--socket", true],
      ["/env.sock", "PODTUI_SOCKET", true],
      ["/ch.sock", "CONTAINER_HOST", false],
      ["/dh.sock", "DOCKER_HOST", false],
      [ROOTLESS, "rootless Podman", false],
      [ROOTFUL, "rootful Podman", false],
      [USER_DOCKER_LINK, "podman-docker link", false],
      [SYSTEM_DOCKER_LINK, "podman-docker link", false],
    ]);
  });

  test("duplicates collapse to the first source (podman-docker's DOCKER_HOST is the rootless socket)", () => {
    const list = socketCandidates(undefined, { ...BASE_ENV, DOCKER_HOST: `unix://${ROOTLESS}` });
    expect(list.filter((c) => c.path === ROOTLESS).map((c) => c.source)).toEqual(["DOCKER_HOST"]);
  });

  test("empty values are ignored", () => {
    const list = socketCandidates("", { ...BASE_ENV, PODTUI_SOCKET: "  ", DOCKER_HOST: "" });
    expect(list[0]?.source).toBe("rootless Podman");
  });
});

describe("resolveSocket: explicit sockets", () => {
  test("--socket wins over PODTUI_SOCKET", async () => {
    const r = await resolveSocket("/cli.sock", { env: { ...BASE_ENV, PODTUI_SOCKET: "/env.sock" }, ...world({ "/cli.sock": "podman", "/env.sock": "podman" }) });
    expect(r).toEqual({ kind: "found", path: "/cli.sock", source: "--socket" });
  });

  test("PODTUI_SOCKET is used when there is no flag", async () => {
    const r = await resolveSocket(undefined, { env: { ...BASE_ENV, PODTUI_SOCKET: "/env.sock" }, ...world({ "/env.sock": "podman" }) });
    expect(r).toEqual({ kind: "found", path: "/env.sock", source: "PODTUI_SOCKET" });
  });

  test("SAFETY: a missing explicit socket never falls back to the real one", async () => {
    // `bun run dev` sets PODTUI_SOCKET to the sandbox. With the sandbox down
    // the old code continued to the user's rootless socket.
    const r = await resolveSocket(undefined, {
      env: { ...BASE_ENV, PODTUI_SOCKET: "/tmp/podtui-dev/podman.sock" },
      ...world({ [ROOTLESS]: "podman" }),
    });
    expect(r.kind).toBe("unreachable");
    if (r.kind === "unreachable") {
      expect(r.tried.map((c) => c.path)).toEqual(["/tmp/podtui-dev/podman.sock"]);
      expect(r.message).toContain("/tmp/podtui-dev/podman.sock");
      expect(r.message).toContain("PODTUI_SOCKET");
      expect(r.fixCommand).toContain("scripts/dev-sandbox.sh up");
    }
  });

  test("an explicit --socket miss names the path, its source and the reason", async () => {
    const r = await resolveSocket("/tmp/custom.sock", { env: BASE_ENV, ...world({ [ROOTLESS]: "podman" }) });
    expect(r.kind).toBe("unreachable");
    if (r.kind === "unreachable") {
      expect(r.message).toBe("No Podman at /tmp/custom.sock (from --socket): not found.");
      expect(r.fixCommand).not.toContain("dev-sandbox");
    }
  });

  test("an explicit socket that is a Docker daemon is refused with a clear reason", async () => {
    const r = await resolveSocket("/var/run/docker.sock", { env: BASE_ENV, ...world({ "/var/run/docker.sock": "docker", [ROOTLESS]: "podman" }) });
    expect(r.kind).toBe("unreachable");
    if (r.kind === "unreachable") {
      expect(r.message).toContain("Docker daemon, not Podman");
      expect(r.fixCommand).toContain("Podman socket");
    }
  });

  test("unix:// works for --socket", async () => {
    const r = await resolveSocket(`unix://${ROOTFUL}`, { env: BASE_ENV, ...world({ [ROOTFUL]: "podman" }) });
    expect(r).toEqual({ kind: "found", path: ROOTFUL, source: "--socket" });
  });
});

describe("resolveSocket: automatic discovery", () => {
  test("rootless default", async () => {
    const r = await resolveSocket(undefined, { env: BASE_ENV, ...world({ [ROOTLESS]: "podman" }) });
    expect(r).toEqual({ kind: "found", path: ROOTLESS, source: "rootless Podman" });
  });

  test("rootful default when there is no rootless socket", async () => {
    const r = await resolveSocket(undefined, { env: BASE_ENV, ...world({ [ROOTFUL]: "podman" }) });
    expect(r).toEqual({ kind: "found", path: ROOTFUL, source: "rootful Podman" });
  });

  test("podman-docker: DOCKER_HOST is honoured", async () => {
    const r = await resolveSocket(undefined, { env: { ...BASE_ENV, DOCKER_HOST: "unix:///srv/podman.sock" }, ...world({ "/srv/podman.sock": "podman", [ROOTLESS]: "podman" }) });
    expect(r).toEqual({ kind: "found", path: "/srv/podman.sock", source: "DOCKER_HOST" });
  });

  test("CONTAINER_HOST is honoured before DOCKER_HOST", async () => {
    const r = await resolveSocket(undefined, {
      env: { ...BASE_ENV, CONTAINER_HOST: "unix:///ch.sock", DOCKER_HOST: "unix:///dh.sock" },
      ...world({ "/ch.sock": "podman", "/dh.sock": "podman" }),
    });
    expect(r).toEqual({ kind: "found", path: "/ch.sock", source: "CONTAINER_HOST" });
  });

  test("a DOCKER_HOST that is real Docker is skipped, and Podman is found after it", async () => {
    const r = await resolveSocket(undefined, {
      env: { ...BASE_ENV, DOCKER_HOST: "unix:///var/run/docker.sock" },
      ...world({ "/var/run/docker.sock": "docker", [ROOTLESS]: "podman" }),
    });
    expect(r).toEqual({ kind: "found", path: ROOTLESS, source: "rootless Podman" });
  });

  test("a remote DOCKER_HOST is skipped as unsupported", async () => {
    const r = await resolveSocket(undefined, { env: { ...BASE_ENV, DOCKER_HOST: "tcp://10.0.0.5:2375" }, ...world({ [ROOTLESS]: "podman" }) });
    expect(r.kind).toBe("found");
  });

  test("podman-docker's docker.sock link is used when nothing else answers", async () => {
    const r = await resolveSocket(undefined, { env: BASE_ENV, ...world({ [SYSTEM_DOCKER_LINK]: "podman" }) });
    expect(r).toEqual({ kind: "found", path: SYSTEM_DOCKER_LINK, source: "podman-docker link" });
  });

  test("real Docker on /run/docker.sock is never used", async () => {
    const r = await resolveSocket(undefined, { env: BASE_ENV, ...world({ [SYSTEM_DOCKER_LINK]: "docker" }) });
    expect(r.kind).toBe("unreachable");
    if (r.kind === "unreachable") {
      expect(r.tried.find((c) => c.path === SYSTEM_DOCKER_LINK)?.outcome).toBe("Docker daemon, not Podman");
    }
  });

  test("nothing found: every candidate is listed in order, with its reason", async () => {
    const r = await resolveSocket(undefined, { env: BASE_ENV, ...world({ [ROOTFUL]: "denied", [USER_DOCKER_LINK]: "file" }) });
    expect(r.kind).toBe("unreachable");
    if (r.kind === "unreachable") {
      expect(r.tried.map((c) => [c.path, c.outcome])).toEqual([
        [ROOTLESS, "not found"],
        [ROOTFUL, "permission denied"],
        [USER_DOCKER_LINK, "not a socket"],
        [SYSTEM_DOCKER_LINK, "not found"],
      ]);
      expect(r.fixCommand).toBe("systemctl --user enable --now podman.socket");
      const text = describeUnreachable(r);
      expect(text).toContain(`${ROOTFUL} (rootful Podman): permission denied`);
      expect(text).toContain("Fix: systemctl --user enable --now podman.socket");
    }
  });

  test("as root the fix is the system unit", async () => {
    const r = await resolveSocket(undefined, { env: BASE_ENV, ...world({}), isRoot: true });
    expect(r.kind === "unreachable" && r.fixCommand).toBe("systemctl enable --now podman.socket");
  });

  test("a socket that does not answer is reported, not used", async () => {
    const r = await resolveSocket(undefined, { env: BASE_ENV, ...world({ [ROOTLESS]: "no answer", [ROOTFUL]: "podman" }) });
    expect(r).toEqual({ kind: "found", path: ROOTFUL, source: "rootful Podman" });
  });
});

describe("probeSocket and statSocket against real sockets", () => {
  let servers: FakeServer[] = [];
  let dir: string;

  beforeEach(() => {
    dir = `/tmp/podtui-test/sock-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    for (const s of servers) s.stop();
    servers = [];
    try {
      chmodSync(`${dir}/locked`, 0o700);
    } catch {
      // not created by this test
    }
    rmSync(dir, { recursive: true, force: true });
  });

  /** Podman answers /libpod/_ping; Docker answers it 404 but /_ping 200. */
  const podmanServer = () =>
    fakeUnixServer("podman", (s, req) => {
      s.write(req.startsWith("GET /libpod/_ping") ? httpResponse(200, "OK", "OK", "text/plain") : httpResponse(404, "Not Found", "{}"));
      s.end();
    });
  const dockerServer = () =>
    fakeUnixServer("docker", (s, req) => {
      s.write(req.startsWith("GET /_ping") ? httpResponse(200, "OK", "OK", "text/plain") : httpResponse(404, "Not Found", '{"message":"page not found"}'));
      s.end();
    });

  /**
   * Real stat for this test's own directory and fake servers; everything else
   * (the machine's real /run/podman, /run/docker.sock, …) reads as missing, so
   * the result cannot depend on what is installed on the test machine.
   */
  const onlyHere = (...extra: FakeServer[]) => (p: string) =>
    p.startsWith(`${dir}/`) || extra.some((s) => s.path === p) ? statSocket(p) : ("not found" as const);

  test("Podman is recognised, Docker is told apart, silence is 'no answer'", async () => {
    const podman = podmanServer();
    const docker = dockerServer();
    servers.push(podman, docker);
    expect(await probeSocket(podman.path)).toBe("podman");
    expect(await probeSocket(docker.path)).toBe("docker");
    expect(await probeSocket(`${dir}/nothing.sock`)).toBe("no answer");
  });

  test("a socket that never answers times out as 'no answer'", async () => {
    const silent = fakeUnixServer("silent", () => undefined);
    servers.push(silent);
    const started = Date.now();
    expect(await probeSocket(silent.path, 300)).toBe("no answer");
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test("statSocket distinguishes missing, regular file, socket and permission denied", () => {
    const server = podmanServer();
    servers.push(server);
    writeFileSync(`${dir}/file`, "");
    mkdirSync(`${dir}/locked`);
    chmodSync(`${dir}/locked`, 0o000);
    expect(statSocket(server.path)).toBe("ok");
    expect(statSocket(`${dir}/missing.sock`)).toBe("not found");
    expect(statSocket(`${dir}/file`)).toBe("not a socket");
    expect(statSocket(`${dir}/locked/x.sock`)).toBe("permission denied");
  });

  test("end to end, podman-docker layout: a docker.sock symlink to the Podman socket is found", async () => {
    const podman = podmanServer();
    servers.push(podman);
    // $XDG_RUNTIME_DIR with podman-docker's tmpfiles link and no podman/ dir.
    symlinkSync(podman.path, `${dir}/docker.sock`);
    const r = await resolveSocket(undefined, { env: { XDG_RUNTIME_DIR: dir }, isRoot: false, stat: onlyHere(podman) });
    if (r.kind !== "found") throw new Error(describeUnreachable(r));
    expect(r).toEqual({ kind: "found", path: `${dir}/docker.sock`, source: "podman-docker link" });
  });

  test("end to end: DOCKER_HOST=unix://… pointing at Podman is used", async () => {
    const podman = podmanServer();
    servers.push(podman);
    const r = await resolveSocket(undefined, { env: { XDG_RUNTIME_DIR: dir, DOCKER_HOST: `unix://${podman.path}` }, isRoot: false, stat: onlyHere(podman) });
    expect(r).toEqual({ kind: "found", path: podman.path, source: "DOCKER_HOST" });
  });

  test("end to end: DOCKER_HOST at a Docker daemon is skipped", async () => {
    const docker = dockerServer();
    const podman = podmanServer();
    servers.push(docker, podman);
    const r = await resolveSocket(undefined, {
      env: { XDG_RUNTIME_DIR: dir, DOCKER_HOST: `unix://${docker.path}`, CONTAINER_HOST: undefined },
      isRoot: false,
      stat: onlyHere(docker, podman),
    });
    expect(r.kind).toBe("unreachable");
    if (r.kind === "unreachable") {
      expect(r.tried[0]).toMatchObject({ path: docker.path, source: "DOCKER_HOST", outcome: "Docker daemon, not Podman" });
    }
  });
});
