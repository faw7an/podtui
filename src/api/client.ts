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
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  if (signal) {
    signal.addEventListener("abort", () => controller.abort());
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
    if (error instanceof EngineError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new EngineError("unreachable", "Request timeout");
    }
    if (error instanceof TypeError && error.message.includes("fetch")) {
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
  timeout?: number;
  signal?: AbortSignal;
}

export async function* streamLines(
  socketPath: string,
  path: string,
  options: StreamOptions = {}
): AsyncGenerator<string, void, unknown> {
  const { signal } = options;

  const controller = new AbortController();
  if (signal) {
    signal.addEventListener("abort", () => controller.abort());
  }

  const fetchOptions: FetchOptions = {
    method: "GET",
    signal: controller.signal,
    unix: socketPath,
  };

  try {
    const response = await fetch(buildUrl(socketPath, path), fetchOptions);

    if (!response.ok) {
      const text = await response.text();
      throw mapHttpError(response.status, text);
    }

    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          yield line;
        }
      }
    }

    if (buffer.trim()) {
      yield buffer;
    }
  } catch (error) {
    if (error instanceof EngineError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    throw new EngineError("unknown", String(error));
  }
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