/**
 * P4-T3 "in use" for volumes, against a throwaway Podman (PODTUI_INTEGRATION=1).
 * MountCount cannot answer it (0 even for a running container's volume); the
 * server's dangling filter and the containers `volume` filter can.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPodmanEngine } from "../src/engine/podman.ts";
import { startThrowawayPodman, THROWAWAY_IMAGE as A, type ThrowawayPodman } from "./helpers/throwawayPodman.ts";

const enabled = Boolean(process.env["PODTUI_INTEGRATION"]);
let t: ThrowawayPodman;

describe.skipIf(!enabled)("volume in-use (live)", () => {
  beforeAll(async () => {
    t = await startThrowawayPodman();
    await t.podman("volume", "create", "v-free");
    await t.podman("run", "-d", "--name", "runner", "-v", "v-run:/data", A, "sleep", "600");
    await t.podman("create", "--name", "idle", "-v", "v-stopped:/data", A, "true");
  }, 120_000);

  afterAll(async () => {
    await t?.stop();
  }, 60_000);

  test("MountCount is 0 even for the running container's volume (why it is not used)", async () => {
    const vols = await createPodmanEngine().listVolumes(t.socket);
    expect(vols.find((v) => v.Name === "v-run")?.MountCount).toBe(0);
  });

  test("dangling = referenced by no container, running or stopped", async () => {
    expect((await createPodmanEngine().danglingVolumeNames(t.socket)).sort()).toEqual(["v-free"]);
  });

  test("containersUsingVolume finds running and stopped users", async () => {
    const e = createPodmanEngine();
    expect((await e.containersUsingVolume(t.socket, "v-run")).map((c) => c.Names[0])).toEqual(["runner"]);
    expect((await e.containersUsingVolume(t.socket, "v-stopped")).map((c) => c.Names[0])).toEqual(["idle"]);
    expect(await e.containersUsingVolume(t.socket, "v-free")).toEqual([]);
  });
});
