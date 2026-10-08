import type { ContainerEngine } from "../../engine/ContainerEngine.ts";
import type { LogBuffer } from "../../util/logBuffer.ts";

/**
 * One follow-mode log stream feeding a `LogBuffer` (P3-T2, P3-T9).
 *
 * No React here, so the lifecycle (open, throttle, abort, end, error) is
 * testable with a fake engine. Frames go into the buffer as they arrive; the
 * UI is told about them at most once per `throttleMs`, which caps redraws
 * (≤ 20 fps at the default 50 ms) however fast the container logs.
 */

export type LogStreamStatus =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "live" }
  /** The server closed the stream: the container stopped or exited. */
  | { kind: "ended" }
  | { kind: "error"; message: string };

/** Lines requested on open. The buffer holds more as they stream in. */
export const LOG_TAIL = 1000;
export const LOG_THROTTLE_MS = 50;

export interface LogSessionOptions {
  buffer: LogBuffer;
  /** New lines are in the buffer; called at most once per `throttleMs`. */
  onLines: () => void;
  onStatus: (status: LogStreamStatus) => void;
  tail?: number;
  throttleMs?: number;
}

/** Start streaming; returns `stop`, which aborts the request and timers. */
export function startLogSession(
  engine: Pick<ContainerEngine, "containerLogs">,
  socketPath: string,
  containerId: string,
  opts: LogSessionOptions,
): () => void {
  const controller = new AbortController();
  const throttleMs = opts.throttleMs ?? LOG_THROTTLE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const flush = (): void => {
    timer = undefined;
    if (!stopped) opts.onLines();
  };

  const schedule = (): void => {
    if (timer === undefined && !stopped) timer = setTimeout(flush, throttleMs);
  };

  opts.onStatus({ kind: "connecting" });

  void (async () => {
    let live = false;
    try {
      for await (const frame of engine.containerLogs(socketPath, containerId, {
        follow: true,
        tail: opts.tail ?? LOG_TAIL,
        timestamps: true,
        signal: controller.signal,
      })) {
        if (stopped) return;
        if (!live) {
          live = true;
          opts.onStatus({ kind: "live" });
        }
        opts.buffer.push(frame);
        schedule();
      }
      if (stopped) return;
      if (timer !== undefined) clearTimeout(timer);
      flush();
      opts.onStatus({ kind: "ended" });
    } catch (e) {
      // Our own abort is the normal way out, not an error.
      if (stopped || controller.signal.aborted) return;
      if (timer !== undefined) clearTimeout(timer);
      flush();
      opts.onStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  })();

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    controller.abort();
  };
}
