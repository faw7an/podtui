import { useEffect, useRef, useState } from "react";
import { DEFAULT_LOG_LINES, LogBuffer } from "../../util/logBuffer.ts";
import { startLineSession, type LineSource, type LogStreamStatus } from "../view/logSession.ts";

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
/**
 * Follow any line source while `source` is non-null; `key` identifies what
 * is followed (a new key = a fresh buffer and a new stream).
 */
export function useLineStream(key: string | null, source: LineSource | null, capacity = DEFAULT_LOG_LINES): LogStreamState {
  const bufferRef = useRef<LogBuffer>(new LogBuffer(capacity));
  const [status, setStatus] = useState<LogStreamStatus>({ kind: "idle" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    bufferRef.current = new LogBuffer(capacity);
    setVersion((v) => v + 1);
    if (!source || !key) {
      setStatus({ kind: "idle" });
      return;
    }
    return startLineSession(source, {
      buffer: bufferRef.current,
      onLines: () => setVersion((v) => v + 1),
      onStatus: setStatus,
    });
  }, [key, source, capacity]);

  return { buffer: bufferRef.current, status, version };
}
