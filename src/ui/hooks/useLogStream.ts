import { useEffect, useRef, useState } from "react";
import type { ContainerEngine } from "../../engine/ContainerEngine.ts";
import { DEFAULT_LOG_LINES, LogBuffer } from "../../util/logBuffer.ts";
import { startLogSession, type LogStreamStatus } from "../view/logSession.ts";

export interface LogStreamState {
  buffer: LogBuffer;
  status: LogStreamStatus;
  /** Bumps when the buffer gained lines; use it as a render dependency. */
  version: number;
}

/**
 * Follow the logs of `containerId` while `enabled` (P3-T2/P3-T9).
 *
 * The stream runs only while the Logs tab is visible for a selected
 * container: changing the container, leaving the tab, hiding the detail pane
 * or unmounting stops it (the effect cleanup aborts the request). Each new
 * container starts with a fresh buffer.
 */
export function useLogStream(
  engine: Pick<ContainerEngine, "containerLogs">,
  socketPath: string,
  containerId: string | null,
  enabled: boolean,
  capacity = DEFAULT_LOG_LINES,
): LogStreamState {
  const bufferRef = useRef<LogBuffer>(new LogBuffer(capacity));
  const [status, setStatus] = useState<LogStreamStatus>({ kind: "idle" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    bufferRef.current = new LogBuffer(capacity);
    setVersion((v) => v + 1);
    if (!enabled || !containerId) {
      setStatus({ kind: "idle" });
      return;
    }
    return startLogSession(engine, socketPath, containerId, {
      buffer: bufferRef.current,
      onLines: () => setVersion((v) => v + 1),
      onStatus: setStatus,
    });
  }, [engine, socketPath, containerId, enabled, capacity]);

  return { buffer: bufferRef.current, status, version };
}
