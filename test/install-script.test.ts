import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * install.sh, run for real (`sh install.sh`) against a local fake GitHub:
 * a Bun HTTP server serving a releases API response, a release tarball and
 * SHA256SUMS. The "binary" in the tarball is a tiny shell script that answers
 * `--version`, so the installer's post-install check runs too.
 */

const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "install.sh");
const VERSION = "0.0.1";
const ARCH = process.arch === "arm64" ? "arm64" : "x64";
const NAME = `podtui-${VERSION}-linux-${ARCH}`;

let work: string;
let server: ReturnType<typeof Bun.serve>;
let base: string;
/** Files the fake GitHub serves, by URL path. Tests may swap entries. */
const files = new Map<string, Uint8Array | string>();

async function sha256(data: Uint8Array): Promise<string> {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "podtui-install-test-"));
  // Build the release tarball exactly as scripts/build-release.sh lays it out.
  const stage = join(work, "stage", NAME);
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "podtui"), `#!/bin/sh\necho "podtui ${VERSION}"\n`);
  chmodSync(join(stage, "podtui"), 0o755);
  writeFileSync(join(stage, "LICENSE"), "MIT\n");
  await Bun.$`tar -C ${join(work, "stage")} -czf ${join(work, `${NAME}.tar.gz`)} ${NAME}`.quiet();
  const tarball = new Uint8Array(readFileSync(join(work, `${NAME}.tar.gz`)));

  files.set("/api/releases", JSON.stringify([{ tag_name: `v${VERSION}`, prerelease: true }]));
  files.set(`/download/v${VERSION}/${NAME}.tar.gz`, tarball);
  files.set(`/download/v${VERSION}/SHA256SUMS`, `${await sha256(tarball)}  ${NAME}.tar.gz\n`);

  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const body = files.get(new URL(req.url).pathname);
      return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
  if (work) rmSync(work, { recursive: true, force: true });
});

interface Run {
  code: number;
  stderr: string;
  installDir: string;
}

async function install(env: Record<string, string> = {}, pathPrefix = ""): Promise<Run> {
  const installDir = mkdtempSync(join(work, "bin-"));
  const proc = Bun.spawn(["sh", SCRIPT], {
    env: {
      PATH: `${pathPrefix}${process.env["PATH"] ?? "/usr/bin:/bin"}`,
      HOME: work,
      PODTUI_INSTALL_DIR: installDir,
      PODTUI_API_URL: `${base}/api/releases`,
      PODTUI_DOWNLOAD_BASE: `${base}/download`,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  return { code, stderr, installDir };
}

/** A PATH directory whose `uname` reports the given system and machine. */
function fakeUname(system: string, machine: string): string {
  const dir = mkdtempSync(join(work, "uname-"));
  writeFileSync(join(dir, "uname"), `#!/bin/sh\ncase "$1" in -s) echo ${system};; -m) echo ${machine};; esac\n`);
  chmodSync(join(dir, "uname"), 0o755);
  return `${dir}:`;
}

describe("install.sh", () => {
  test("installs the newest release (pre-releases included), verified and runnable", async () => {
    const r = await install();
    expect(r.code).toBe(0);
    const bin = join(r.installDir, "podtui");
    expect(existsSync(bin)).toBe(true);
    expect(statSync(bin).mode & 0o111).not.toBe(0);
    expect(r.stderr).toContain("checksum verified");
    expect(r.stderr).toContain(`installed podtui ${VERSION} to ${bin}`);
    expect(r.stderr).toContain("systemctl --user enable --now podman.socket");
    // No temporary file left next to the binary.
    expect(existsSync(join(r.installDir, ".podtui.new"))).toBe(false);
  });

  test("PODTUI_VERSION pins a version, with or without the v", async () => {
    for (const v of [VERSION, `v${VERSION}`]) {
      // An API that would fail proves the pinned path does not query it.
      const r = await install({ PODTUI_VERSION: v, PODTUI_API_URL: `${base}/nope` });
      expect(r.code).toBe(0);
    }
  });

  test("a checksum mismatch installs nothing", async () => {
    const good = files.get(`/download/v${VERSION}/SHA256SUMS`)!;
    files.set(`/download/v${VERSION}/SHA256SUMS`, `${"0".repeat(64)}  ${NAME}.tar.gz\n`);
    try {
      const r = await install();
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain("checksum mismatch");
      expect(r.stderr).toContain("nothing was installed");
      expect(existsSync(join(r.installDir, "podtui"))).toBe(false);
    } finally {
      files.set(`/download/v${VERSION}/SHA256SUMS`, good);
    }
  });

  test("a missing release asset fails with a clear message", async () => {
    const r = await install({ PODTUI_VERSION: "9.9.9" });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("could not download");
    expect(r.stderr).toContain("v9.9.9");
  });

  test("no published release yet is explained", async () => {
    const real = files.get("/api/releases")!;
    files.set("/api/releases", "[]");
    try {
      const r = await install();
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain("no podtui release has been published yet");
    } finally {
      files.set("/api/releases", real);
    }
  });

  test("a version with path characters is rejected before any download", async () => {
    const r = await install({ PODTUI_VERSION: "1.0.0/../../evil" });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("invalid version");
  });

  test("macOS and unsupported CPUs are refused with a reason", async () => {
    const mac = await install({}, fakeUname("Darwin", "arm64"));
    expect(mac.code).not.toBe(0);
    expect(mac.stderr).toContain("Linux binaries only (this system is Darwin)");

    const riscv = await install({}, fakeUname("Linux", "riscv64"));
    expect(riscv.code).not.toBe(0);
    expect(riscv.stderr).toContain("unsupported CPU architecture: riscv64");
  });

  test("warns when the install directory is not on PATH, and not when it is", async () => {
    const off = await install();
    expect(off.stderr).toContain("is not on your PATH");

    const dir = mkdtempSync(join(work, "onpath-"));
    const on = await install({ PODTUI_INSTALL_DIR: dir }, `${dir}:`);
    expect(on.code).toBe(0);
    expect(on.stderr).not.toContain("is not on your PATH");
  });

  test("a binary that cannot run here installs nothing and keeps the old one", async () => {
    // Same release, but the "binary" exits non-zero (as a glibc build does on
    // musl/Alpine — observed with the real binary in an alpine container).
    const stage = join(work, "broken-stage", NAME);
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "podtui"), "#!/bin/sh\nexit 127\n");
    chmodSync(join(stage, "podtui"), 0o755);
    const tgz = join(work, "broken.tar.gz");
    await Bun.$`tar -C ${join(work, "broken-stage")} -czf ${tgz} ${NAME}`.quiet();
    const broken = new Uint8Array(readFileSync(tgz));
    const goodTar = files.get(`/download/v${VERSION}/${NAME}.tar.gz`)!;
    const goodSums = files.get(`/download/v${VERSION}/SHA256SUMS`)!;

    const first = await install();
    expect(first.code).toBe(0);
    const bin = join(first.installDir, "podtui");
    const before = readFileSync(bin, "utf8");

    files.set(`/download/v${VERSION}/${NAME}.tar.gz`, broken);
    files.set(`/download/v${VERSION}/SHA256SUMS`, `${await sha256(broken)}  ${NAME}.tar.gz\n`);
    try {
      const r = await install({ PODTUI_INSTALL_DIR: first.installDir });
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain("does not run on this system, so nothing was installed");
      expect(readFileSync(bin, "utf8")).toBe(before);
      expect(existsSync(join(first.installDir, ".podtui.new"))).toBe(false);
    } finally {
      files.set(`/download/v${VERSION}/${NAME}.tar.gz`, goodTar);
      files.set(`/download/v${VERSION}/SHA256SUMS`, goodSums);
    }
  });

  test("reinstalling replaces the existing binary", async () => {
    const first = await install();
    const again = await install({ PODTUI_INSTALL_DIR: first.installDir });
    expect(again.code).toBe(0);
    expect(existsSync(join(first.installDir, "podtui"))).toBe(true);
  });
});
