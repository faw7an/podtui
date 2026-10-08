import type { PanelId } from "../layout/types.ts";
import type { ResourceData } from "./build.ts";
import type { QuadletListItem } from "../../api/types.ts";
import { describeState, type UnitState } from "../../engine/systemd.ts";
import { quadletType } from "../../engine/quadlet.ts";

/**
 * The slice of the engine the refresh loop needs. Declared structurally so a
 * mock with call counters can be substituted in tests (ROADMAP P2-T3).
 */
export interface ListEngine {
  listContainers(socketPath: string, all?: boolean): Promise<unknown[]>;
  listPods(socketPath: string): Promise<unknown[]>;
  listImages(socketPath: string, all?: boolean): Promise<unknown[]>;
  listVolumes(socketPath: string): Promise<unknown[]>;
  danglingVolumeNames(socketPath: string): Promise<string[]>;
  listQuadlets?(socketPath: string): Promise<QuadletListItem[]>;
  listNetworks(socketPath: string): Promise<unknown[]>;
}

/** Unit states for the quadlet panel; absent = state unknown. */
export type QuadletStates = (units: string[]) => Promise<Map<string, UnitState>>;

/**
 * Quadlets: Podman's list (it computes unit names), then ONE batched
 * `systemctl show` for their states. Each side can fail on its own; the
 * panel then says why instead of looking empty (P6-T6).
 */
async function fetchQuadlets(engine: ListEngine, socketPath: string, states?: QuadletStates): Promise<Partial<ResourceData>> {
  if (!engine.listQuadlets) return { quadlets: [], quadletNote: "This engine cannot list quadlets." };
  let items: QuadletListItem[];
  try {
    items = await engine.listQuadlets(socketPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      quadlets: [],
      quadletNote: /404|not found/i.test(msg)
        ? "This Podman has no quadlet API (GET /libpod/quadlets/json); a newer Podman is needed for this panel."
        : `Could not list quadlets: ${msg}`,
    };
  }
  let map = new Map<string, UnitState>();
  let note: string | null = null;
  if (states && items.length > 0) {
    try {
      map = await states(items.map((q) => q.UnitName));
    } catch (e) {
      note = `systemd did not answer (${e instanceof Error ? e.message : String(e)}); unit states are unknown.`;
    }
  }
  return {
    quadletNote: note,
    quadlets: items.map((q) => {
      const s = map.get(q.UnitName);
      return {
        id: q.Name,
        name: q.Name,
        unit: q.UnitName,
        type: quadletType(q.Name),
        path: q.Path,
        state: s ? describeState(s) : q.Status ? q.Status.toLowerCase() : "unknown",
        active: s?.active ?? "",
        load: s?.load ?? (q.Status === "Not loaded" ? "not-found" : ""),
      };
    }),
  };
}

export interface RefreshOutcome {
  data: ResourceData;
  /** Human-readable message for a resource that failed to refresh. */
  error?: string;
}

/** Which list call feeds which panel. Quadlets has no source until Phase 6. */
const FETCHERS: Record<
  Exclude<PanelId, "quadlets">,
  (engine: ListEngine, socketPath: string) => Promise<Partial<ResourceData>>
> = {
  containers: async (e, s) => ({ containers: (await e.listContainers(s, true)) as ResourceData["containers"] }),
  pods: async (e, s) => ({ pods: (await e.listPods(s)) as ResourceData["pods"] }),
  images: async (e, s) => ({ images: (await e.listImages(s, true)) as ResourceData["images"] }),
  // Volumes need a second list to know which are in use (P4-T3).
  volumes: async (e, s) => {
    const [volumes, dangling] = await Promise.all([e.listVolumes(s), e.danglingVolumeNames(s)]);
    return { volumes: volumes as ResourceData["volumes"], danglingVolumes: dangling };
  },
  networks: async (e, s) => ({ networks: (await e.listNetworks(s)) as ResourceData["networks"] }),
};

/**
 * Build the refresh function used by the poll loop.
 *
 * Only panels that are currently visible are fetched (FR-3: "Hidden panels do
 * not poll or stream"). Data for a hidden panel is carried over from the
 * previous refresh rather than blanked, so toggling a panel back on shows its
 * last known contents immediately instead of flashing empty.
 *
 * Resources are fetched concurrently and independently: one failing endpoint
 * reports an error but still lets the others through.
 */
export function createVisibleFetcher(engine: ListEngine, socketPath: string, quadletStates?: QuadletStates) {
  return async function fetchVisible(
    visible: ReadonlySet<PanelId>,
    previous: ResourceData,
  ): Promise<RefreshOutcome> {
    const data: ResourceData = { ...previous };
    const errors: string[] = [];

    const work = (Object.keys(FETCHERS) as (keyof typeof FETCHERS)[])
      .filter((panel) => visible.has(panel))
      .map(async (panel) => {
        try {
          Object.assign(data, await FETCHERS[panel](engine, socketPath));
        } catch (e) {
          errors.push(`${panel}: ${e instanceof Error ? e.message : String(e)}`);
        }
      });

    if (visible.has("quadlets")) {
      work.push(
        fetchQuadlets(engine, socketPath, quadletStates).then((q) => {
          Object.assign(data, q);
        }),
      );
    }

    await Promise.all(work);

    return errors.length > 0 ? { data, error: errors.join("; ") } : { data };
  };
}
/**
 * Run `tick` now and then every `intervalMs` AFTER the previous tick settles.
 *
 * `setInterval` fired regardless of whether the last refresh had finished, so
 * with a slow or unreachable daemon (each request may take up to the 10s
 * client timeout, twice the 5s poll) requests piled up, and a late, older
 * response could overwrite newer data. Here at most one tick is in flight,
 * and `isCurrent()` turns false once the loop is stopped, so a tick that was
 * already running when the loop was replaced can drop its result.
 *
 * Returns `stop`. Timer functions are injectable for tests.
 */
export function startPollLoop(
  tick: (isCurrent: () => boolean) => Promise<void>,
  intervalMs: number,
  timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } = { setTimeout, clearTimeout },
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const isCurrent = () => !stopped;

  const run = async (): Promise<void> => {
    try {
      await tick(isCurrent);
    } catch {
      // A tick reports its own errors; the loop must keep going regardless.
    }
    if (!stopped) timer = timers.setTimeout(() => void run(), intervalMs);
  };

  void run();
  return () => {
    stopped = true;
    if (timer !== undefined) timers.clearTimeout(timer);
  };
}
