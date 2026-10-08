import { useEffect, useState } from "react";
import type { ContainerTop } from "../../api/types.ts";
import type { ContainerEngine } from "../../engine/ContainerEngine.ts";
import { startPollLoop } from "../view/refresh.ts";
import { TOP_POLL_MS } from "../view/topView.ts";

export type TopStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; top: ContainerTop; at: number }
  | { kind: "error"; message: string };

/**
 * Poll `top` for `containerId` every TOP_POLL_MS while `enabled` (P3-T8/T9).
 * At most one request in flight (`startPollLoop`); any change stops the loop
 * and a late answer from the old container is dropped.
 */
export function useTopPoll(
  engine: Pick<ContainerEngine, "containerTop">,
  socketPath: string,
  containerId: string | null,
  enabled: boolean,
): TopStatus {
  const [status, setStatus] = useState<TopStatus>({ kind: "idle" });

  useEffect(() => {
    if (!enabled || !containerId) {
      setStatus({ kind: "idle" });
      return;
    }
    setStatus({ kind: "loading" });
    return startPollLoop(async (isCurrent) => {
      try {
        const top = await engine.containerTop(socketPath, containerId);
        if (isCurrent()) setStatus({ kind: "ok", top, at: Date.now() });
      } catch (e) {
        if (isCurrent()) setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    }, TOP_POLL_MS);
  }, [engine, socketPath, containerId, enabled]);

  return status;
}
