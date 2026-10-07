import { fetch } from "bun";

export class EngineError extends Error {
  constructor(
    public readonly kind: "unreachable" | "notFound" | "conflict" | "unknown",
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  body?: unknown;
  timeout?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

interface FetchOptions extends RequestInit {
  unix?: string;
}

const BASE_PATH = "/v5.0.0/libpod";

function buildUrl(socketPath: string, path: string): string {
  return `http://d${BASE_PATH}${path}`;
}

/**
 * Read a JSON body, or fail loudly.
 *
 * An empty body is never turned into `{}`: that cast promised a shape the
 * response did not contain, and the resulting error appeared far from its cause
 * (e.g. `{}` reaching code that then called `.map`). Endpoints that legitimately
 * answer `204 No Content` must go through `postVoid`/`delVoid` instead, which
 * state that they expect nothing.
 */
export async function parseJson<T>(response: Response, context?: string): Promise<T> {
  return parseJsonText<T>(await response.text(), response.status, context);
}

function parseJsonText<T>(text: string, status: number, context?: string): T {
  if (!text.trim()) {
    throw new EngineError(
      "unknown",
      `Expected a JSON body but the response was empty${context ? ` (${context})` : ""}`,
      status,
      text,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new EngineError("unknown", "Invalid JSON response", status, text);
  }
}

const MAX_MESSAGE = 300;

/**
 * The readable part of a libpod error body. Podman answers
 * `{"cause","message","response"}` for errors (verified live, e.g. 500
 * "cannot remove container … as it is running"), and pod actions answer
 * 409 `{"Errs":[…],"Id"}` when some containers failed (pkg/api/handlers/
 * libpod/pods.go, v5.8.4). Anything else falls back to the raw text.
 */
function serverMessage(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (typeof record["message"] === "string" && record["message"]) return record["message"];
      const errs = record["Errs"];
      if (Array.isArray(errs) && errs.length > 0) {
        const texts = errs.filter((e): e is string => typeof e === "string" && e.length > 0);
        return texts.length > 0
          ? texts.join("; ")
          : `${errs.length} container${errs.length === 1 ? "" : "s"} failed`;
      }
    }
  } catch {
    // Not JSON: use the text itself below.
  }
  const text = body.trim();
  return text ? text : undefined;
}

function clip(text: string): string {
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;
}

/**
 * Map an HTTP error status to an `EngineError`, carrying Podman's own message.
 *
 * A 500 is NOT "unreachable": Podman answered, it just refused or failed (it
 * uses 500 for ordinary state errors such as removing a running container or
 * pausing a stopped one — verified live). Reporting those as "daemon
 * unreachable" sent users looking for a dead socket. Only gateway statuses,
 * which mean something between us and Podman failed, map to `unreachable`.
 */
export function mapHttpError(status: number, body: string): EngineError {
  const detail = serverMessage(body);
  const withDetail = (fallback: string) => clip(detail ?? fallback);
  switch (status) {
    case 404:
      return new EngineError("notFound", withDetail("Resource not found"), status, body);
    case 409:
      return new EngineError("conflict", withDetail("Resource conflict"), status, body);
    case 502:
    case 503:
    case 504:
      return new EngineError("unreachable", `Podman unreachable (HTTP ${status})`, status, body);
    default:
      return new EngineError("unknown", withDetail(`HTTP ${status}`), status, body);
  }
}

/**
 * Bun's signals for "could not talk to the socket at all", all observed:
 * `TypeError` (Bun 1.4.x, pinned by test/client-requests.test.ts), and on Bun
 * 1.3.10 an `Error` whose `code` is `FailedToOpenSocket` (missing file, stale
 * socket with no listener, permission denied and non-socket files all give
 * this) or `ECONNRESET` (the daemon closed the connection mid-response).
 * Matching only `TypeError` turned a dead daemon into an opaque "unknown"
 * error on Bun 1.3.10.
 */
const CONNECT_FAILED_CODES = new Set(["FailedToOpenSocket"]);
const CONNECTION_LOST_CODES = new Set(["ECONNRESET"]);

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/** A connection-level failure as a readable `EngineError`, or undefined. */
export function connectionError(error: unknown, socketPath: string): EngineError | undefined {
  const code = errorCode(error);
  if (code !== undefined && CONNECTION_LOST_CODES.has(code)) {
    return new EngineError("unreachable", `Connection to Podman was lost (${socketPath})`);
  }
  if (error instanceof TypeError || (code !== undefined && CONNECT_FAILED_CODES.has(code))) {
    return new EngineError("unreachable", `Cannot connect to the Podman socket at ${socketPath}`);
  }
  return undefined;
}

interface SentResponse {
  status: number;
  text: string;
}

/**
 * Perform the request, read the WHOLE body, and map errors. The timeout covers
 * the body read too: previously it was cleared as soon as headers arrived, so
 * a daemon that stalled mid-body hung the call forever. The external abort
 * listener is removed on every path (it used to leak on success).
 *
 * 304 is success: Podman answers it when an action is a no-op — starting a
 * running container, starting a running pod, stopping a stopped pod (all
 * verified live). It was previously thrown as "HTTP 304: ".
 */
async function send(
  socketPath: string,
  path: string,
  options: RequestOptions = {}
): Promise<SentResponse> {
  const { method = "GET", body, timeout = 10000, signal, headers = {}, query = {} } = options;

  const controller = new AbortController();
  const onExternalAbort = (): void => controller.abort();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort);
  }

  const queryString = new URLSearchParams(query).toString();
  const fullPath = queryString ? `${path}?${queryString}` : path;

  const fetchOptions: FetchOptions = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    signal: controller.signal,
    unix: socketPath,
  };

  if (body !== undefined) {
    fetchOptions.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(buildUrl(socketPath, fullPath), fetchOptions);
    const text = await response.text();

    if (!response.ok && response.status !== 304) {
      throw mapHttpError(response.status, text);
    }

    return { status: response.status, text };
  } catch (error) {
    if (error instanceof EngineError) {
      throw error;
    }
    if (isAbortError(error)) {
      // A deliberate cancellation must not be reported as a slow daemon: the
      // two are indistinguishable to the user otherwise.
      throw new EngineError(
        "unreachable",
        signal?.aborted ? "Request aborted" : `Request timeout after ${timeout}ms`,
      );
    }
    throw connectionError(error, socketPath) ?? new EngineError("unknown", String(error));
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

export async function request<T>(
  socketPath: string,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { status, text } = await send(socketPath, path, options);
  return parseJsonText<T>(text, status, `${options.method ?? "GET"} ${path}`);
}

export const get = <T>(socketPath: string, path: string, options?: Omit<RequestOptions, "method" | "body">) =>
  request<T>(socketPath, path, { ...options, method: "GET" });

export const post = <T>(socketPath: string, path: string, body: unknown, options?: Omit<RequestOptions, "method">) =>
  request<T>(socketPath, path, { ...options, method: "POST", body });

export const del = <T>(socketPath: string, path: string, options?: Omit<RequestOptions, "method" | "body">) =>
  request<T>(socketPath, path, { ...options, method: "DELETE" });

export const put = <T>(socketPath: string, path: string, body: unknown, options?: Omit<RequestOptions, "method">) =>
  request<T>(socketPath, path, { ...options, method: "PUT", body });

/** Outcome of an action endpoint. `changed: false` means Podman answered 304. */
export interface VoidResult {
  changed: boolean;
}

/**
 * Action endpoints whose body we do not need. Verified live: start/stop answer
 * `204` (empty), pod actions answer `200` with a report, `DELETE
 * /containers/{id}` answers `200` with a JSON array, and no-op actions answer
 * `304`. The body is read and discarded (inside `send`), which also keeps the
 * connection from being left half-read.
 */
export async function postVoid(
  socketPath: string,
  path: string,
  body?: unknown,
  options?: Omit<RequestOptions, "method">
): Promise<VoidResult> {
  const { status } = await send(socketPath, path, { ...options, method: "POST", body });
  return { changed: status !== 304 };
}

export async function delVoid(
  socketPath: string,
  path: string,
  options?: Omit<RequestOptions, "method" | "body">
): Promise<VoidResult> {
  const { status } = await send(socketPath, path, { ...options, method: "DELETE" });
  return { changed: status !== 304 };
}

export interface StreamOptions {
  /**
   * Cancels the stream. Streams are long-lived by design, so there is no
   * default timeout: a caller that wants one must abort it.
   */
  signal?: AbortSignal;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

/**
 * Stream the raw response body as byte chunks.
 *
 * This is what binary/multiplexed payloads (container logs) must be read
 * through: `streamLines` decodes UTF-8 and splits on newlines, which would
 * corrupt any payload that is not line-oriented text.
 *
 * Abort handling: an external `signal` is bridged onto the internal controller,
 * and the reader is cancelled in `finally`, so breaking out of a `for await`
 * releases the socket immediately instead of leaving `reader.read()` pending.
 */
export async function* streamChunks(
  socketPath: string,
  path: string,
  options: StreamOptions = {}
): AsyncGenerator<Uint8Array, void, unknown> {
  const { signal } = options;

  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort);
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(buildUrl(socketPath, path), {
      method: "GET",
      signal: controller.signal,
      unix: socketPath,
    });

    if (!response.ok) {
      const text = await response.text();
      throw mapHttpError(response.status, text);
    }

    reader = response.body?.getReader();
    if (!reader) return;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) yield value;
    }
  } catch (error) {
    if (error instanceof EngineError) throw error;
    // An abort is a normal way for a stream to end, not an error.
    if (isAbortError(error)) return;
    // Same mapping as request(): a dead socket, or a daemon that dies
    // mid-stream (ECONNRESET), is "unreachable", not an opaque "unknown".
    throw connectionError(error, socketPath) ?? new EngineError("unknown", String(error));
  } finally {
    // Release the connection on early exit (break/abort) as well as on EOF.
    try {
      await reader?.cancel();
    } catch {
      // The stream may already be closed; nothing to release.
    }
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Newline-delimited text view of `streamChunks` (used for JSON streams). */
export async function* streamLines(
  socketPath: string,
  path: string,
  options: StreamOptions = {}
): AsyncGenerator<string, void, unknown> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of streamChunks(socketPath, path, options)) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield line;
    }
  }

  const tail = buffer + decoder.decode();
  if (tail.trim()) yield tail;
}

export async function* streamJson<T>(
  socketPath: string,
  path: string,
  options: StreamOptions = {}
): AsyncGenerator<T, void, unknown> {
  for await (const line of streamLines(socketPath, path, options)) {
    try {
      yield JSON.parse(line);
    } catch {
      // Skip invalid JSON lines
    }
  }
}