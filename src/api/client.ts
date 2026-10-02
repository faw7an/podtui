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

export async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new EngineError("unknown", "Invalid JSON response", response.status, text);
  }
}

export function mapHttpError(status: number, body: string): EngineError {
  switch (status) {
    case 404:
      return new EngineError("notFound", "Resource not found", status, body);
    case 409:
      return new EngineError("conflict", "Resource conflict", status, body);
    case 0:
    case 500:
    case 502:
    case 503:
    case 504:
      return new EngineError("unreachable", `Podman daemon unreachable (${status})`, status, body);
    default:
      return new EngineError("unknown", `HTTP ${status}: ${body.slice(0, 200)}`, status, body);
  }
}

export async function request<T>(
  socketPath: string,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
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
    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      throw mapHttpError(response.status, text);
    }

    return parseJson<T>(response);
  } catch (error) {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onExternalAbort);
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
    if (error instanceof TypeError) {
      // Bun reports a missing/unreachable unix socket as a TypeError from fetch.
      throw new EngineError("unreachable", "Failed to connect to Podman socket");
    }
    throw new EngineError("unknown", String(error));
  }
}

export const get = <T>(socketPath: string, path: string, options?: Omit<RequestOptions, "method" | "body">) =>
  request<T>(socketPath, path, { ...options, method: "GET" });

export const post = <T>(socketPath: string, path: string, body: unknown, options?: Omit<RequestOptions, "method">) =>
  request<T>(socketPath, path, { ...options, method: "POST", body });

export const del = <T>(socketPath: string, path: string, options?: Omit<RequestOptions, "method" | "body">) =>
  request<T>(socketPath, path, { ...options, method: "DELETE" });

export const put = <T>(socketPath: string, path: string, body: unknown, options?: Omit<RequestOptions, "method">) =>
  request<T>(socketPath, path, { ...options, method: "PUT", body });

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
    // Same mapping as request(): an unreachable socket is "unreachable", not an
    // opaque "unknown" (FR-8 wants readable errors).
    if (error instanceof TypeError) {
      throw new EngineError("unreachable", "Failed to connect to Podman socket");
    }
    throw new EngineError("unknown", String(error));
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