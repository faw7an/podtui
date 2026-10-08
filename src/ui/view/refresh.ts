import type { PanelId } from "../layout/types.ts";
import type { ResourceData } from "./build.ts";

/**
 * The slice of the engine the refresh loop needs. Declared structurally so a
 * mock with call counters can be substituted in tests (ROADMAP P2-T3).
 */
export interface ListEngine {
  listContainers(socketPath: string, all?: boolean): Promise<unknown[]>;
  listPods(socketPath: string): Promise<unknown[]>;
  listImages(socketPath: string, all?: boolean): Promise<unknown[]>;
  listVolumes(socketPath: string): Promise<unknown[]>;
  listNetworks(socketPath: string): Promise<unknown[]>;
}

export interface RefreshOutcome {
  data: ResourceData;
  /** Human-readable message for a resource that failed to refresh. */
  error?: string;
}

/** Which list call feeds which panel. Quadlets has no source until Phase 6. */
const FETCHERS: Record<
  Exclude<PanelId, "quadlets">,
  (engine: ListEngine, socketPath: string) => Promise<unknown>
> = {
  containers: (e, s) => e.listContainers(s, true),
  pods: (e, s) => e.listPods(s),
  images: (e, s) => e.listImages(s, true),
  volumes: (e, s) => e.listVolumes(s),
  networks: (e, s) => e.listNetworks(s),
};

const PANEL_TO_KEY: Record<Exclude<PanelId, "quadlets">, keyof ResourceData> = {
  containers: "containers",
  pods: "pods",
  images: "images",
  volumes: "volumes",
  networks: "networks",
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
export function createVisibleFetcher(engine: ListEngine, socketPath: string) {
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
          const items = await FETCHERS[panel](engine, socketPath);
          (data as unknown as Record<string, unknown>)[PANEL_TO_KEY[panel]] = items;
        } catch (e) {
          errors.push(`${panel}: ${e instanceof Error ? e.message : String(e)}`);
        }
      });

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
