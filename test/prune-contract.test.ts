import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPodmanEngine } from "../src/engine/podman.ts";
import { assertSandboxSocket } from "./helpers/sandboxGuard.ts";
import {
  startThrowawayPodman,
  THROWAWAY_IMAGE as A,
  type ThrowawayPodman,
} from "./helpers/throwawayPodman.ts";

/**
 * The prune CONTRACT: for every resource kind, the preview deletes nothing
 * (the libpod prune endpoints have no dry-run; an earlier "dry run" really
 * pruned) and names exactly what
 * the real prune then removes — nothing more (a confirm dialog would lie) and
 * nothing less (the user would lose things they were never shown).
 *
 * This runs REAL prunes, so it uses a private throwaway Podman under
 * /tmp/podtui-test/ (never the dev sandbox, whose seeded resources other tests
 * rely on, and never a real socket — see the guard). Each kind is seeded with
 * the edge cases that broke the old previews:
 *
 *   containers  paused, pod member, pod infra (all kept) vs created/exited
 *   images      a dangling image whose untagged parent is pruned in round 2
 *   volumes     a NAMED unused volume (the old preview hid it) vs one held by
 *               a stopped container (kept)
 *   networks    the default network (never pruned) and one held by a stopped
 *               container (kept)
 *
 * Kinds run in an order where each prune leaves the next kind's holders in
 * place: networks and volumes first, while their holder containers exist.
 */

const enabled = Boolean(process.env["PODTUI_INTEGRATION"]);
const engine = createPodmanEngine();
let t: ThrowawayPodman;

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean).sort();

describe.skipIf(!enabled)("prune contract: preview == what prune removes", () => {
  beforeAll(async () => {
    t = await startThrowawayPodman();
    assertSandboxSocket(t.socket);

    // Containers. `run ... true` blocks until exit, so t-exited is exited.
    await t.podman("create", "--name", "t-created", A, "true");
    await t.podman("run", "--name", "t-exited", A, "true");
    await t.podman("run", "-d", "--name", "t-paused", A, "sleep", "600");
    await t.podman("pause", "t-paused");
    await t.podman("pod", "create", "--name", "t-pod");
    await t.podman("create", "--pod", "t-pod", "--name", "t-podmember", A, "true");

    // Volumes: one named + unused, one held only by a stopped container.
    await t.podman("volume", "create", "t-vol-unused");
    await t.podman("volume", "create", "t-vol-held");

    // Networks: one unused, one held only by a stopped container.
    await t.podman("network", "create", "t-net-unused");
    await t.podman("network", "create", "t-net-held");
    await t.podman(
      "create", "--name", "t-holder",
      "-v", "t-vol-held:/data", "--network", "t-net-held",
      A, "true",
    );

    // Images: build a two-RUN image and untag it. Its top image is dangling;
    // its intermediate parent only becomes dangling once the top is gone.
    await Bun.write(`${t.dir}/ctx/Containerfile`, `FROM ${A}\nRUN echo a > /a\nRUN echo b > /b\n`);
    await t.podman("build", "-q", "-t", "t-chain:1", `${t.dir}/ctx`);
    await t.podman("untag", "t-chain:1");
  }, 180_000);

  afterAll(async () => {
    await t?.stop();
  }, 60_000);

  test("networks", async () => {
    const before = lines(await t.podman("network", "ls", "--format", "{{.Name}}"));
    const preview = (await engine.pruneNetworks(t.socket, true)).networks?.names ?? [];
    expect(lines(await t.podman("network", "ls", "--format", "{{.Name}}"))).toEqual(before);
    expect([...preview].sort()).toEqual(["t-net-unused"]);

    const result = await engine.pruneNetworks(t.socket);
    const after = lines(await t.podman("network", "ls", "--format", "{{.Name}}"));
    const removed = before.filter((n) => !after.includes(n));
    expect(removed).toEqual([...preview].sort());
    expect(result.networks?.names.sort()).toEqual(removed);
    expect(after).toContain("podman");
    expect(after).toContain("t-net-held");
  }, 60_000);

  test("volumes — named unused volumes ARE pruned and must be previewed", async () => {
    const before = lines(await t.podman("volume", "ls", "-q"));
    const preview = (await engine.pruneVolumes(t.socket, true)).volumes?.names ?? [];
    expect(lines(await t.podman("volume", "ls", "-q"))).toEqual(before);
    expect([...preview].sort()).toEqual(["t-vol-unused"]);

    const result = await engine.pruneVolumes(t.socket);
    const after = lines(await t.podman("volume", "ls", "-q"));
    const removed = before.filter((v) => !after.includes(v));
    expect(removed).toEqual([...preview].sort());
    expect(result.volumes?.names.sort()).toEqual(removed);
    expect(after).toContain("t-vol-held");
  }, 60_000);

  test("images — including the second convergence round", async () => {
    const list = async () => lines(await t.podman("images", "-a", "-q", "--no-trunc"))
      .map((id) => id.replace(/^sha256:/, "").slice(0, 12));
    const before = await list();
    const preview = (await engine.pruneImages(t.socket, true)).images?.names ?? [];
    expect(await list()).toEqual(before);
    // Top image + its intermediate parent; a single-pass preview finds only one.
    expect(preview.length).toBe(2);

    const result = await engine.pruneImages(t.socket);
    const after = await list();
    const removed = before.filter((i) => !after.includes(i)).sort();
    expect(removed).toEqual([...preview].sort());
    expect(result.images?.names.sort()).toEqual(removed);
  }, 60_000);

  test("containers — paused and pod containers are kept", async () => {
    const names = async () => lines(await t.podman("ps", "-a", "--format", "{{.Names}}"));
    const before = await names();
    const preview = (await engine.pruneContainers(t.socket, true)).containers?.names ?? [];
    expect(await names()).toEqual(before);
    expect([...preview].sort()).toEqual(["t-created", "t-exited", "t-holder"]);

    const result = await engine.pruneContainers(t.socket);
    const after = await names();
    const removed = before.filter((n) => !after.includes(n));
    expect(removed).toEqual([...preview].sort());
    expect(result.containers?.count).toBe(removed.length);
    expect(after).toContain("t-paused");
    expect(after).toContain("t-podmember");
  }, 60_000);
});
