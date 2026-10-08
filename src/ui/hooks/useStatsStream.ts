import { useEffect, useState } from "react";
import type { ContainerEngine } from "../../engine/ContainerEngine.ts";
import { EMPTY_HISTORY, pushSample, type StatsHistory } from "../view/statsView.ts";
import { startStatsSession, type StatsStreamStatus } from "../view/statsSession.ts";

/**
 * Follow live stats of `containerId` while `enabled` (P3-T7/P3-T9). The
 * stream runs only while the Stats tab shows a RUNNING container: a stopped
 * container's stream sends nothing but zeros (verified), so the tab says it
 * is not running instead. Any change closes the stream and clears history.
 */
export function useStatsStream(
  engine: Pick<ContainerEngine, "streamStats">,
  socketPath: string,
  containerId: string | null,
  enabled: boolean,
): { history: StatsHistory; status: StatsStreamStatus } {
  const [history, setHistory] = useState<StatsHistory>(EMPTY_HISTORY);
  const [status, setStatus] = useState<StatsStreamStatus>({ kind: "idle" });

  useEffect(() => {
    setHistory(EMPTY_HISTORY);
    if (!enabled || !containerId) {
      setStatus({ kind: "idle" });
      return;
    }
    return startStatsSession(engine, socketPath, containerId, {
      onSample: (s) => setHistory((h) => pushSample(h, s)),
      onStatus: setStatus,
    });
  }, [engine, socketPath, containerId, enabled]);

  return { history, status };
}
