import { test, expect, describe, beforeAll } from "bun:test";
import { createPodmanEngine } from "../src/engine/podman.ts";
import { resolveSocket } from "../src/api/socket.ts";
import { assertSandboxSocket } from "./helpers/sandboxGuard.ts";

/**
 * R-04 regression tests: a prune PREVIEW must never destroy anything.
 *
 * The libpod prune endpoints take no parameters, so an earlier
 * `{dryRun:true}` request body was silently ignored and the prune really ran.
 * These tests call every preview against the dev sandbox and assert that the
 * resource lists are unchanged afterwards.
 *
 * WHAT the previews report is checked elsewhere, against the real prune:
 * `prune-contract.test.ts` (throwaway service) and `prune-preview.test.ts`
 * (pure rules). The old versions of these tests compared each preview with a
 * copy of its own predicate, which is how the "named volumes are never
 * pruned" mistake passed: the test and the code shared the same wrong belief.
 */

export { assertSandboxSocket };

const SOCKET_PATH = "/tmp/podtui-dev/podman.sock";
const engine = createPodmanEngine();
const enabled = Boolean(process.env["PODTUI_INTEGRATION"]);

async function snapshot() {
  const [containers, images, volumes, networks] = await Promise.all([
    engine.listContainers(SOCKET_PATH, true),
    engine.listImages(SOCKET_PATH, true),
    engine.listVolumes(SOCKET_PATH),
    engine.listNetworks(SOCKET_PATH),
  ]);
  return {
    containers: containers.map((c) => c.Id).sort(),
    images: images.map((i) => i.Id).sort(),
    volumes: volumes.map((v) => v.Name).sort(),
    networks: networks.map((n) => n.name).sort(),
  };
}

describe.skipIf(!enabled)("R-04: prune previews are read-only", () => {
  beforeAll(async () => {
    assertSandboxSocket(SOCKET_PATH);
    const result = await resolveSocket(SOCKET_PATH);
    if (result.kind === "unreachable") {
      throw new Error(`Sandbox not reachable: ${result.message}`);
    }
  });

  test("container preview deletes nothing", async () => {
    const before = await snapshot();
    await engine.pruneContainers(SOCKET_PATH, true);
    expect(await snapshot()).toEqual(before);
  });

  test("image preview deletes nothing", async () => {
    const before = await snapshot();
    await engine.pruneImages(SOCKET_PATH, true);
    expect(await snapshot()).toEqual(before);
  });

  test("volume preview deletes nothing, and names the unused named volume", async () => {
    const before = await snapshot();
    const preview = await engine.pruneVolumes(SOCKET_PATH, true);
    expect(await snapshot()).toEqual(before);
    // The seeded `test-volume` is named and unused, so a real prune WOULD
    // delete it; the preview must say so (the old rule hid it).
    expect(preview.volumes?.names).toContain("test-volume");
  });

  test("network preview deletes nothing and never offers the default network", async () => {
    const before = await snapshot();
    const preview = await engine.pruneNetworks(SOCKET_PATH, true);
    expect(await snapshot()).toEqual(before);
    expect(preview.networks?.names).not.toContain("podman");
  });
});

describe("assertSandboxSocket guard", () => {
  test("accepts sandbox paths", () => {
    expect(() => assertSandboxSocket("/tmp/podtui-dev/podman.sock")).not.toThrow();
    expect(() => assertSandboxSocket("/tmp/podtui-test/podman.sock")).not.toThrow();
  });

  test("rejects production and custom sockets", () => {
    expect(() => assertSandboxSocket("/run/user/1000/podman/podman.sock")).toThrow();
    expect(() => assertSandboxSocket("/run/podman/podman.sock")).toThrow();
    expect(() => assertSandboxSocket("/custom/path.sock")).toThrow();
    // A path that merely *contains* the sandbox dir must not slip through.
    expect(() => assertSandboxSocket("/etc/tmp/podtui-dev/podman.sock")).toThrow();
  });
});
