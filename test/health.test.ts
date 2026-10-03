import { describe, expect, test } from "bun:test";
import { healthSuffix } from "../src/util/format.ts";
import { buildFrameModel, EMPTY_DATA, type ResourceData } from "../src/ui/view/build.ts";
import type { ContainerListItem } from "../src/api/types.ts";

/**
 * P2-T5: healthy/unhealthy suffix on container rows.
 *
 * Verified live against the sandbox on 2026-10-04 with two throwaway
 * containers (`--health-cmd "exit 0"` and `"exit 1"`, both cleaned up):
 *
 *   list `Status`  = "healthy" | "unhealthy" | ""   ("" = no healthcheck)
 *   list `State`   = the lifecycle enum, unchanged   ("running" in both cases)
 *   inspect        = State.Health { Status, FailingStreak, Log } | null
 *
 * So the suffix reads the list `Status` field — the same field pods reuse for
 * their lifecycle word ("Running"), which is why this applies to containers
 * only. An unhealthy container forces the error tone no matter its lifecycle
 * state: `running` + `unhealthy` must read as a problem.
 */

function container(overrides: Partial<ContainerListItem> = {}): ContainerListItem {
  return {
    Id: "abc123",
    Names: ["/web"],
    Image: "docker.io/library/nginx:alpine",
    ImageID: "img1",
    Command: null,
    Created: "2026-10-03T07:24:54Z",
    State: "running",
    Status: "",
    Ports: null,
    Labels: {},
    Size: null,
    NetworkSettings: { Networks: {} },
    Mounts: [],
    IsInfra: false,
    Pod: "",
    PodName: "",
    RestartCount: 0,
    Pid: 100,
    ExitCode: 0,
    Exited: false,
    ExitedAt: 0,
    StartedAt: 0,
    ...overrides,
  };
}

function stateCell(status: string): { text: string; tone: string } {
  const data: ResourceData = { ...EMPTY_DATA, containers: [container({ Status: status })] };
  const model = buildFrameModel({
    data,
    selected: { pods: "", containers: "abc123", images: "", volumes: "", networks: "", quadlets: "" },
    focus: "containers",
    now: 0,
    clock: "",
  });
  const row = model.panels.find((p) => p.id === "containers")?.items[0];
  return { text: row?.cells["state"] ?? "", tone: row?.tone ?? "" };
}

describe("healthSuffix", () => {
  test("no healthcheck means no suffix and no tone change", () => {
    expect(healthSuffix("")).toEqual({ suffix: "" });
    expect(healthSuffix(undefined)).toEqual({ suffix: "" });
  });

  test("healthy appends a suffix and keeps the lifecycle tone", () => {
    expect(healthSuffix("healthy")).toEqual({ suffix: "· healthy" });
  });

  test("unhealthy appends a suffix and forces the error tone", () => {
    expect(healthSuffix("unhealthy")).toEqual({ suffix: "· unhealthy", tone: "error" });
  });

  test("an unrecognized value passes through unstyled rather than vanishing", () => {
    // The API may add states this session never observed; displaying the raw
    // value is honest, inventing a colour for it is not.
    expect(healthSuffix("starting")).toEqual({ suffix: "· starting" });
  });
});

describe("container rows carry the health suffix", () => {
  test("a healthy container reads 'running · healthy' with the ok tone", () => {
    const cell = stateCell("healthy");
    expect(cell.text).toBe("● running · healthy");
    expect(cell.tone).toBe("ok");
  });

  test("an unhealthy container reads 'running · unhealthy' with the error tone", () => {
    const cell = stateCell("unhealthy");
    expect(cell.text).toBe("● running · unhealthy");
    expect(cell.tone).toBe("error");
  });

  test("no healthcheck leaves the row exactly as before", () => {
    const cell = stateCell("");
    expect(cell.text).toBe("● running");
    expect(cell.tone).toBe("ok");
  });
});