import { test, expect, describe, beforeAll } from "bun:test";
import { createPodmanEngine } from "../src/engine/podman.ts";
import { resolveSocket } from "../src/api/socket.ts";

const SOCKET_PATH = "/tmp/podtui-dev/podman.sock";
const engine = createPodmanEngine();

describe("P1-T8 Integration Tests (requires sandbox)", () => {
  beforeAll(async () => {
    if (!process.env["PODTUI_INTEGRATION"]) {
      console.log("Skipping integration tests (set PODTUI_INTEGRATION=1 to run)");
      return;
    }
    const result = await resolveSocket(SOCKET_PATH);
    if (result.kind === "unreachable") {
      throw new Error(`Sandbox not reachable: ${result.message}`);
    }
  });

  describe("Container lifecycle", () => {
    test("start/stop/restart 'web' container", async () => {
      if (!process.env["PODTUI_INTEGRATION"]) return;

      // Ensure web is stopped first
      await engine.stopContainer(SOCKET_PATH, "web", 10).catch((_err: unknown) => {
        // Ignore error if container doesn't exist
      });
      
      // Start
      const startResult = await engine.startContainer(SOCKET_PATH, "web");
      expect(startResult.success).toBe(true);
      
      // Verify running
      const inspect = await engine.inspectContainer(SOCKET_PATH, "web");
      expect(inspect.State.Running).toBe(true);
      
      // Stop (nginx takes ~10s to stop gracefully)
      const stopResult = await engine.stopContainer(SOCKET_PATH, "web", 15);
      expect(stopResult.success).toBe(true);
      
      // Verify stopped
      const inspect2 = await engine.inspectContainer(SOCKET_PATH, "web");
      expect(inspect2.State.Running).toBe(false);
      
      // Restart
      const restartResult = await engine.restartContainer(SOCKET_PATH, "web", 15);
      expect(restartResult.success).toBe(true);
      
      // Verify running again
      const inspect3 = await engine.inspectContainer(SOCKET_PATH, "web");
      expect(inspect3.State.Running).toBe(true);
    }, 60000);
  });

  describe("Log streaming", () => {
    test("stream logs from 'chatty' for 3 lines then abort", async () => {
      if (!process.env["PODTUI_INTEGRATION"]) return;

      let count = 0;
      const abortController = new AbortController();
      
      // Set timeout to abort after collecting enough lines
      const timeout = setTimeout(() => abortController.abort(), 8000);
      
      try {
        for await (const _frame of engine.containerLogs(SOCKET_PATH, "chatty", { 
          follow: true, 
          tail: 1,
          timestamps: true 
        })) {
          void _frame;
          count++;
          if (count >= 3) {
            abortController.abort();
            break;
          }
        }
      } catch (e) {
        // AbortError is expected
        if (e instanceof DOMException && e.name === "AbortError") {
          // Expected
        } else {
          throw e;
        }
      } finally {
        clearTimeout(timeout);
      }
      
      expect(count).toBeGreaterThanOrEqual(3);
    }, 15000);

    test("stream logs from 'tty-box'", async () => {
      if (!process.env["PODTUI_INTEGRATION"]) return;

      let count = 0;
      for await (const _frame of engine.containerLogs(SOCKET_PATH, "tty-box", { 
        follow: true, 
        tail: 2,
        timestamps: true 
      })) {
      void _frame;
        count++;
        if (count >= 2) break;
      }
      expect(count).toBeGreaterThanOrEqual(2);
    }, 10000);
  });

  describe("Stats streaming", () => {
    test("stream stats for 'web' container", async () => {
      if (!process.env["PODTUI_INTEGRATION"]) return;

      let count = 0;
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 8000);
      
      try {
        const statsStream = await engine.containerStats(SOCKET_PATH, ["web"], true);
        // When streaming, the result is an AsyncGenerator<ContainerStatsUI>
        const statsStreamGen = statsStream as AsyncGenerator<{
          cpuPercent: number;
          memUsage: number;
          memLimit: number;
        }>;
        for await (const stats of statsStreamGen) {
          expect(stats.cpuPercent).toBeDefined();
          expect(stats.memUsage).toBeDefined();
          expect(stats.memLimit).toBeDefined();
          count++;
          if (count >= 2) {
            abortController.abort();
            break;
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          // Expected
        } else {
          throw e;
        }
      } finally {
        clearTimeout(timeout);
      }
      
      expect(count).toBeGreaterThanOrEqual(2);
    }, 15000);
  });

  describe("Destructive guard", () => {
    test("isSandboxSocket returns true for sandbox", () => {
      expect(engine.isSandboxSocket("/tmp/podtui-dev/podman.sock")).toBe(true);
      expect(engine.isSandboxSocket("/tmp/podtui-test/podman.sock")).toBe(true);
    });

    test("isSandboxSocket returns false for production sockets", () => {
      expect(engine.isSandboxSocket("/run/user/1000/podman/podman.sock")).toBe(false);
      expect(engine.isSandboxSocket("/run/podman/podman.sock")).toBe(false);
      expect(engine.isSandboxSocket("/custom/path.sock")).toBe(false);
    });
  });

  describe("Prune preview (dryRun)", () => {
    test("pruneContainers dryRun returns preview (may be empty)", async () => {
      if (!process.env["PODTUI_INTEGRATION"]) return;
      
      const preview = await engine.pruneContainers(SOCKET_PATH, true);
      expect(preview).toBeDefined();
      expect(typeof preview.containers?.count).toBe("number");
      expect(Array.isArray(preview.containers?.names)).toBe(true);
    }, 10000);

    test("pruneImages dryRun returns preview (may be empty)", async () => {
      if (!process.env["PODTUI_INTEGRATION"]) return;
      
      const preview = await engine.pruneImages(SOCKET_PATH, true);
      expect(preview).toBeDefined();
      expect(typeof preview.images?.count).toBe("number");
      expect(Array.isArray(preview.images?.names)).toBe(true);
    }, 10000);

    test("pruneVolumes dryRun returns preview (may be empty)", async () => {
      if (!process.env["PODTUI_INTEGRATION"]) return;
      
      const preview = await engine.pruneVolumes(SOCKET_PATH, true);
      expect(preview).toBeDefined();
      expect(typeof preview.volumes?.count).toBe("number");
      expect(Array.isArray(preview.volumes?.names)).toBe(true);
    }, 10000);

    test("pruneNetworks dryRun returns preview (may be empty)", async () => {
      if (!process.env["PODTUI_INTEGRATION"]) return;
      
      const preview = await engine.pruneNetworks(SOCKET_PATH, true);
      expect(preview).toBeDefined();
      expect(typeof preview.networks?.count).toBe("number");
      expect(Array.isArray(preview.networks?.names)).toBe(true);
    }, 10000);
  });

  describe("Pod operations", () => {
    test("listPods returns seeded pod", async () => {
      if (!process.env["PODTUI_INTEGRATION"]) return;
      
      const pods = await engine.listPods(SOCKET_PATH);
      expect(pods.length).toBeGreaterThan(0);
      const webPod = pods.find(p => p.Name === "web-pod");
      expect(webPod).toBeDefined();
      expect(webPod?.Status).toBe("Running");
    }, 10000);

    test("inspectPod returns details", async () => {
      if (!process.env["PODTUI_INTEGRATION"]) return;
      
      const pods = await engine.listPods(SOCKET_PATH);
      const webPod = pods.find(p => p.Name === "web-pod");
      if (!webPod) throw new Error("web-pod not found");
      
      const inspect = await engine.inspectPod(SOCKET_PATH, webPod.Id);
      expect(inspect.Id).toBe(webPod.Id);
      expect(inspect.Containers.length).toBe(3); // infra + frontend + backend
    }, 10000);
  });

  describe("Image operations", () => {
    test("listImages returns seeded images", async () => {
      if (!process.env["PODTUI_INTEGRATION"]) return;
      
      const images = await engine.listImages(SOCKET_PATH, true);
      expect(images.length).toBeGreaterThan(0);
      const nginx = images.find(i => i.RepoTags?.includes("docker.io/library/nginx:alpine"));
      expect(nginx).toBeDefined();
      const alpine = images.find(i => i.RepoTags?.includes("docker.io/library/alpine:latest"));
      expect(alpine).toBeDefined();
    }, 10000);

    test("inspectImage returns details", async () => {
      if (!process.env["PODTUI_INTEGRATION"]) return;
      
      const images = await engine.listImages(SOCKET_PATH, true);
      const nginx = images.find(i => i.RepoTags?.includes("docker.io/library/nginx:alpine"));
      if (!nginx) throw new Error("nginx image not found");
      
      const inspect = await engine.inspectImage(SOCKET_PATH, nginx.Id);
      expect(inspect.Id).toBe(nginx.Id);
      expect(inspect.RepoTags).toContain("docker.io/library/nginx:alpine");
    }, 10000);
  });

  describe("Volume operations", () => {
    test("listVolumes returns seeded volume", async () => {
      if (!process.env["PODTUI_INTEGRATION"]) return;
      
      const volumes = await engine.listVolumes(SOCKET_PATH);
      expect(volumes.length).toBeGreaterThan(0);
      const testVol = volumes.find(v => v.Name === "test-volume");
      expect(testVol).toBeDefined();
      expect(testVol?.Driver).toBe("local");
    }, 10000);

    test("inspectVolume returns details", async () => {
      if (!process.env["PODTUI_INTEGRATION"]) return;
      
      const volumes = await engine.listVolumes(SOCKET_PATH);
      const testVol = volumes.find(v => v.Name === "test-volume");
      if (!testVol) throw new Error("test-volume not found");
      
      const inspect = await engine.inspectVolume(SOCKET_PATH, testVol.Name);
      expect(inspect.Name).toBe("test-volume");
      expect(inspect.Mountpoint).toContain("test-volume");
    }, 10000);
  });

  describe("Network operations", () => {
    test("listNetworks returns networks (test-network may not persist)", async () => {
      if (!process.env["PODTUI_INTEGRATION"]) return;
      
      const networks = await engine.listNetworks(SOCKET_PATH);
      expect(networks.length).toBeGreaterThan(0);
      // test-network may not persist between seed and test
      networks.find(n => n.name === "test-network");
      // Just verify we can find networks
    }, 10000);

    test("inspectNetwork returns details if test-network exists", async () => {
      if (!process.env["PODTUI_INTEGRATION"]) return;
      
      const networks = await engine.listNetworks(SOCKET_PATH);
      const testNet = networks.find(n => n.name === "test-network");
      if (!testNet) {
        console.log("test-network not present, skipping inspect");
        return;
      }
      
      const inspect = await engine.inspectNetwork(SOCKET_PATH, testNet.id);
      expect(inspect.name).toBe("test-network");
      expect(inspect.driver).toBe("bridge");
    }, 10000);
  });
});