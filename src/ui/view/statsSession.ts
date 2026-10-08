import type { ContainerEngine } from "../../engine/ContainerEngine.ts";
import type { StatsSample } from "./statsView.ts";

/**
 * One live stats stream (P3-T7, P3-T9). Same lifecycle contract as
 * `startLogSession`: no React, `stop` aborts, our own abort is not an error.
 * Samples arrive once per second, so no extra throttle is needed.
 */

export type StatsStreamStatus =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "live" }
  | { kind: "ended" }
  | { kind: "error"; message: string };

export interface StatsSessionOptions {
  onSample: (sample: StatsSample) => void;
  onStatus: (status: StatsStreamStatus) => void;
  interval?: number;
  now?: () => number;
}

export function startStatsSession(
  engine: Pick<ContainerEngine, "streamStats">,
  socketPath: string,
  containerId: string,
  opts: StatsSessionOptions,
): () => void {
  const controller = new AbortController();
  const now = opts.now ?? Date.now;
  let stopped = false;
  opts.onStatus({ kind: "connecting" });

  void (async () => {
    let live = false;
    try {
      for await (const s of engine.streamStats(socketPath, containerId, {
        interval: opts.interval ?? 1,
        signal: controller.signal,
      })) {
        if (stopped) return;
        if (!live) {
          live = true;
          opts.onStatus({ kind: "live" });
        }
        opts.onSample({ ...s, at: now() });
      }
      if (!stopped) opts.onStatus({ kind: "ended" });
    } catch (e) {
      if (stopped || controller.signal.aborted) return;
      opts.onStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  })();

  return () => {
    stopped = true;
    controller.abort();
  };
}
