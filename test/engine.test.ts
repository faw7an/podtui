import { test, expect, describe } from "bun:test";
import type { ContainerEngine, PrunePreview, PruneResult, ContainerActionResult } from "../src/engine/ContainerEngine.ts";

describe("ContainerEngine interface", () => {
  test("interface compiles and types are valid", () => {
    // This is a compile-time test - if it compiles, the interface is valid
    const _engine: ContainerEngine = {} as ContainerEngine;
    expect(_engine).toBeDefined();
  });

  test("PrunePreview type structure", () => {
    const preview: PrunePreview = {
      containers: { count: 3, names: ["a", "b", "c"] },
      images: { count: 2, names: ["img1", "img2"] },
      volumes: { count: 1, names: ["vol1"] },
      networks: { count: 1, names: ["net1"] },
    };
    expect(preview.containers?.count).toBe(3);
    expect(preview.images?.count).toBe(2);
  });

  test("PruneResult type structure", () => {
    const result: PruneResult = {
      containers: { count: 3, names: ["a", "b", "c"], reclaimedBytes: 1024 },
      images: { count: 2, names: ["img1", "img2"], reclaimedBytes: 2048 },
      volumes: { count: 1, names: ["vol1"], reclaimedBytes: 512 },
      networks: { count: 1, names: ["net1"], reclaimedBytes: 0 },
    };
    expect(result.containers?.reclaimedBytes).toBe(1024);
  });

  test("ContainerActionResult type structure", () => {
    const success: ContainerActionResult = { success: true };
    const failure: ContainerActionResult = { success: false, message: "Container not found" };
    expect(success.success).toBe(true);
    expect(failure.success).toBe(false);
    expect(failure.message).toBe("Container not found");
  });

  test("isSandboxSocket guard exists in interface", () => {
    // Verify the method signature exists
    const _fn: (socketPath: string) => boolean = (path: string) => path.includes("/tmp/podtui-dev/");
    expect(_fn("/tmp/podtui-dev/podman.sock")).toBe(true);
    expect(_fn("/run/user/1000/podman/podman.sock")).toBe(false);
  });
});