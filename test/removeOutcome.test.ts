/**
 * DELETE answers read correctly (bodies recorded live, Podman 5.8.4).
 * The bug this pins: removing the default network answered 200 with the
 * refusal inside the body, and the app reported "network podman removed".
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { removeOutcome, type RemovedKind } from "../src/engine/podman.ts";

const fx = JSON.parse(readFileSync("test/fixtures/remove-reports.json", "utf8")) as Record<string, { status: number; body: string }>;
const outcome = (kind: RemovedKind, name: string) => removeOutcome(kind, fx[name]!.status, fx[name]!.body);

describe("removeOutcome", () => {
  test("plain successes", () => {
    expect(outcome("network", "networkRemoved")).toEqual({ success: true });
    expect(outcome("volume", "volumeRemoved")).toEqual({ success: true });
    expect(outcome("container", "containerRemoved")).toEqual({ success: true });
    expect(outcome("pod", "podRemoved")).toEqual({ success: true });
  });

  test("a refusal inside a 200 is an error carrying Podman's text", () => {
    expect(() => outcome("network", "networkDefaultRefused")).toThrow("default network podman cannot be removed");
  });

  test("removing one tag of an image says it was only untagged", () => {
    expect(outcome("image", "imageUntagOnly")).toEqual({
      success: true,
      message: "Untagged localhost/probe-tag:1; the image stays (it has other tags)",
    });
  });

  test("per-item errors in pod and image reports are errors too", () => {
    expect(() => removeOutcome("pod", 200, JSON.stringify({ Id: "p", Err: null, RemovedCtrs: { c1: "container c1 is busy" } }))).toThrow("container c1 is busy");
    expect(() => removeOutcome("image", 200, JSON.stringify({ Deleted: [], Errors: ["boom"], ExitCode: 2 }))).toThrow("boom");
    expect(() => removeOutcome("container", 200, JSON.stringify([{ Id: "c", Err: {} }]))).toThrow("removal failed");
  });

  test("304 is a no-op, not an error", () => {
    expect(removeOutcome("container", 304, "")).toEqual({ success: true, message: "Already in that state; nothing changed" });
  });
});
