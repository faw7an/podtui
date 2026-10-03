import { test, expect, describe } from "bun:test";
import { EngineError, mapHttpError, parseJson } from "../src/api/client.ts";

describe("EngineError", () => {
  test("creates error with kind and statusCode", () => {
    const err = new EngineError("notFound", "Container not found", 404, "{}");
    expect(err.kind).toBe("notFound");
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe("Container not found");
  });
});

describe("mapHttpError", () => {
  test("maps 404 to notFound", () => {
    const err = mapHttpError(404, '{"message":"Not found"}');
    expect(err.kind).toBe("notFound");
    expect(err.statusCode).toBe(404);
  });

  test("maps 409 to conflict", () => {
    const err = mapHttpError(409, '{"message":"Conflict"}');
    expect(err.kind).toBe("conflict");
    expect(err.statusCode).toBe(409);
  });

  test("maps 500 to unreachable", () => {
    const err = mapHttpError(500, "Internal Server Error");
    expect(err.kind).toBe("unreachable");
    expect(err.statusCode).toBe(500);
  });

  test("maps 502/503/504 to unreachable", () => {
    expect(mapHttpError(502, "Bad Gateway").kind).toBe("unreachable");
    expect(mapHttpError(503, "Service Unavailable").kind).toBe("unreachable");
    expect(mapHttpError(504, "Gateway Timeout").kind).toBe("unreachable");
  });

  test("maps unknown status to unknown", () => {
    const err = mapHttpError(418, "I'm a teapot");
    expect(err.kind).toBe("unknown");
    expect(err.statusCode).toBe(418);
  });
});

describe("parseJson", () => {
  test("parses valid JSON", async () => {
    const mockResponse = {
      text: async () => '{"id":"abc","name":"test"}',
    } as Response;
    const result = await parseJson<{ id: string; name: string }>(mockResponse);
    expect(result).toEqual({ id: "abc", name: "test" });
  });

  test("throws on an empty body instead of inventing {}", async () => {
    // This used to assert `expect(result).toEqual({})`, which pinned the very
    // lie R-10 removed: an empty body is not an empty object. Endpoints that
    // really answer 204 use postVoid/delVoid now (test/client-empty-body.test.ts).
    const mockResponse = {
      text: async () => "",
      status: 204,
    } as Response;
    await expect(parseJson(mockResponse)).rejects.toMatchObject({
      kind: "unknown",
      message: "Expected a JSON body but the response was empty",
    });
  });

  test("names the request when the body is empty, so the call site is obvious", async () => {
    const mockResponse = {
      text: async () => "",
      status: 204,
    } as Response;
    await expect(parseJson(mockResponse, "POST /containers/web/start")).rejects.toMatchObject({
      message: "Expected a JSON body but the response was empty (POST /containers/web/start)",
    });
  });

  test("throws EngineError on invalid JSON", async () => {
    const mockResponse = {
      text: async () => "not json",
      status: 200,
    } as Response;
    await expect(parseJson(mockResponse)).rejects.toMatchObject({
      kind: "unknown",
      message: "Invalid JSON response",
    });
  });
});