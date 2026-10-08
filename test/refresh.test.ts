import { describe, expect, test } from "bun:test";
import { createVisibleFetcher, startPollLoop } from "../src/ui/view/refresh";
import { EMPTY_DATA, type ResourceData } from "../src/ui/view/build";
import type { PanelId } from "../src/ui/layout/types";

/**
 * R-13 / P2-T3: hidden panels do not fetch or poll (FR-3).
 *
 * Acceptance criterion from ROADMAP P2-T3: "Hidden panels do not fetch or poll
 * (assert in a test via a mock engine call counter)." Previously `App.fetchAll`
 * listed all five resources on every tick regardless of which panels were
 * shown, so hiding a panel changed nothing about the polling.
 */

interface Counters {
  containers: number;
  pods: number;
  images: number;
  volumes: number;
  networks: number;
}

function mockEngine() {
  const calls: Counters = { containers: 0, pods: 0, images: 0, volumes: 0, networks: 0 };
  const engine = {
    listContainers: async () => {
      calls.containers++;
      return [];
    },
    listPods: async () => {
      calls.pods++;
      return [];
    },
    listImages: async () => {
      calls.images++;
      return [];
    },
    listVolumes: async () => {
      calls.volumes++;
      return [];
    },
    listNetworks: async () => {
      calls.networks++;
      return [];
    },
    // Fetched together with listVolumes (P4-T3), counted with it.
    danglingVolumeNames: async () => [],
  };
  return { engine, calls };
}

const SOCKET = "/tmp/podtui-dev/podman.sock";

describe("R-13: hidden panels are not fetched", () => {
  test("only the visible panel's list is requested", async () => {
    const { engine, calls } = mockEngine();
    const fetchVisible = createVisibleFetcher(engine, SOCKET);

    const visible = new Set<PanelId>(["containers"]);
    await fetchVisible(visible, EMPTY_DATA);

    expect(calls.containers).toBe(1);
    expect(calls.pods).toBe(0);
    expect(calls.images).toBe(0);
    expect(calls.volumes).toBe(0);
    expect(calls.networks).toBe(0);
  });

  test("each visible panel is fetched, hidden ones are not", async () => {
    const { engine, calls } = mockEngine();
    const fetchVisible = createVisibleFetcher(engine, SOCKET);

    await fetchVisible(new Set<PanelId>(["containers", "images"]), EMPTY_DATA);

    expect(calls.containers).toBe(1);
    expect(calls.images).toBe(1);
    expect(calls.pods).toBe(0);
    expect(calls.volumes).toBe(0);
    expect(calls.networks).toBe(0);
  });

  test("all six panels visible fetches everything except quadlets (no source yet)", async () => {
    const { engine, calls } = mockEngine();
    const fetchVisible = createVisibleFetcher(engine, SOCKET);

    await fetchVisible(
      new Set<PanelId>(["pods", "containers", "images", "volumes", "networks", "quadlets"]),
      EMPTY_DATA,
    );

    expect(calls.containers).toBe(1);
    expect(calls.pods).toBe(1);
    expect(calls.images).toBe(1);
    expect(calls.volumes).toBe(1);
    expect(calls.networks).toBe(1);
  });

  test("a hidden panel's previously fetched data is preserved, not cleared", async () => {
    const { engine } = mockEngine();
    const fetchVisible = createVisibleFetcher(engine, SOCKET);

    const { data: withContainers } = await fetchVisible(new Set<PanelId>(["containers"]), EMPTY_DATA);
    expect(withContainers.containers).toEqual([]);
    // Pods was never fetched, so the previous (empty) value is carried over.
    expect(withContainers.pods).toBe(EMPTY_DATA.pods);
  });

  test("repeated ticks do not re-fetch a panel that is hidden throughout", async () => {
    const { engine, calls } = mockEngine();
    const fetchVisible = createVisibleFetcher(engine, SOCKET);
    const visible = new Set<PanelId>(["containers"]);

    let data: ResourceData = EMPTY_DATA;
    for (let i = 0; i < 5; i++) {
      ({ data } = await fetchVisible(visible, data));
    }
    expect(calls.containers).toBe(5);
    expect(calls.pods + calls.images + calls.volumes + calls.networks).toBe(0);
  });

  test("re-showing a panel fetches it again", async () => {
    const { engine, calls } = mockEngine();
    const fetchVisible = createVisibleFetcher(engine, SOCKET);
    let data: ResourceData = EMPTY_DATA;

    ({ data } = await fetchVisible(new Set<PanelId>(["containers"]), data));
    ({ data } = await fetchVisible(new Set<PanelId>(["images"]), data));
    await fetchVisible(new Set<PanelId>(["containers", "images"]), data);

    expect(calls.containers).toBe(2);
    expect(calls.images).toBe(2);
  });

  test("one failing resource does not lose the others", async () => {
    const calls = { containers: 0, pods: 0 };
    const engine = {
      listContainers: async () => {
        calls.containers++;
        return [];
      },
      listPods: async () => {
        calls.pods++;
        throw new Error("pod endpoint down");
      },
      listImages: async () => [],
      listVolumes: async () => [],
      listNetworks: async () => [],
    };
    const fetchVisible = createVisibleFetcher(engine as never, SOCKET);

    const { data, error } = await fetchVisible(
      new Set<PanelId>(["containers", "pods", "images"]),
      EMPTY_DATA,
    );
    expect(calls.containers).toBe(1);
    expect(calls.pods).toBe(1);
    // The healthy resources still landed, and the failure is reported.
    expect(data.containers).toEqual([]);
    expect(data.images).toEqual([]);
    expect(error).toContain("pods");
    // The failed resource keeps its previous value rather than being blanked.
    expect(data.pods).toBe(EMPTY_DATA.pods);
  });
});
describe("startPollLoop: one refresh at a time", () => {
  test("a tick slower than the interval never overlaps the next one", async () => {
    // With setInterval(5ms) and 40ms ticks, ~8 ticks would be in flight at once.
    let inFlight = 0;
    let maxInFlight = 0;
    let ticks = 0;
    const stop = startPollLoop(async () => {
      ticks++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Bun.sleep(40);
      inFlight--;
    }, 5);
    await Bun.sleep(300);
    stop();
    expect(ticks).toBeGreaterThan(2);
    expect(maxInFlight).toBe(1);
  });

  test("stop prevents further ticks and marks a running tick as stale", async () => {
    let ticks = 0;
    let staleSeen: boolean | undefined;
    const stop = startPollLoop(async (isCurrent) => {
      ticks++;
      await Bun.sleep(30);
      staleSeen = !isCurrent();
    }, 5);
    await Bun.sleep(10);
    stop();
    await Bun.sleep(80);
    expect(ticks).toBe(1);
    expect(staleSeen).toBe(true);
  });

  test("a failing tick does not end the loop", async () => {
    let ticks = 0;
    const stop = startPollLoop(async () => {
      ticks++;
      throw new Error("daemon down");
    }, 5);
    await Bun.sleep(60);
    stop();
    expect(ticks).toBeGreaterThan(2);
  });
});
