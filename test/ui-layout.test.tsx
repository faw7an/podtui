import { test, expect, describe } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { Panel, buildRowLine, statusColor, windowItems } from "../src/ui/panels/Panel.tsx";
import { formatBytes, shortenImageName } from "../src/ui/App.tsx";

const noop = (): void => undefined;

describe("buildRowLine", () => {
  test("pads name and appends status on ONE line, exactly innerWidth", () => {
    const line = buildRowLine({ id: "1", label: "web", status: "running" }, false, 34);
    expect(line.length).toBe(34);
    expect(line.startsWith("  web")).toBe(true);
    expect(line.endsWith("● running   ")).toBe(true);
    expect(line.includes("\n")).toBe(false);
  });

  test("marker column is identical for every row length combo", () => {
    for (const label of ["w", "web", "web-pod-backend"]) {
      for (const status of ["running", "exited", "restarting"]) {
        const line = buildRowLine({ id: "1", label, status }, false, 40);
        expect(line.indexOf("●")).toBe(buildRowLine({ id: "2", label: "x", status: "running" }, false, 40).indexOf("●"));
      }
    }
  });

  test("marks the selected row with >", () => {
    const line = buildRowLine({ id: "1", label: "web", status: "running" }, true, 34);
    expect(line.startsWith("> ")).toBe(true);
  });

  test("aligns status column across rows of differing name lengths", () => {
    const a = buildRowLine({ id: "1", label: "web", status: "running" }, false, 40);
    const b = buildRowLine({ id: "2", label: "web-pod-backend", status: "exited" }, false, 40);
    expect(a.indexOf("●")).toBe(b.indexOf("●"));
  });

  test("truncates long names to fit and never exceeds innerWidth", () => {
    const line = buildRowLine({ id: "1", label: "docker.io/library/nginx:alpine", status: "ready" }, false, 24);
    expect(line.length).toBeLessThanOrEqual(24);
    expect(line).toContain("…");
  });

  test("output length never exceeds innerWidth for extreme labels", () => {
    const line = buildRowLine({ id: "1", label: "x".repeat(200), status: "restarting" }, true, 12);
    expect(line.length).toBeLessThanOrEqual(12);
  });
});

describe("statusColor", () => {
  test("maps states to htop-style colors", () => {
    expect(statusColor("running")).toBe("green");
    expect(statusColor("Exited")).toBe("red");
    expect(statusColor("paused")).toBe("yellow");
    expect(statusColor("mounted")).toBe("green");
    expect(statusColor("weird")).toBe("dim");
  });
});

describe("windowItems", () => {
  const items = Array.from({ length: 20 }, (_, i) => i);

  test("returns everything when it fits", () => {
    const { slice, offset } = windowItems([1, 2, 3], 1, 10);
    expect(slice).toEqual([1, 2, 3]);
    expect(offset).toBe(0);
  });

  test("windows around the selection", () => {
    const { slice, offset } = windowItems(items, 10, 5);
    expect(slice.length).toBe(5);
    expect(slice).toContain(10);
    expect(offset).toBe(8);
  });

  test("never exceeds maxRows at either end", () => {
    expect(windowItems(items, 0, 5).slice.length).toBe(5);
    expect(windowItems(items, 19, 5).slice.length).toBe(5);
  });
});

describe("shortenImageName", () => {
  test("strips docker.io/library prefix but keeps tag", () => {
    expect(shortenImageName("docker.io/library/nginx:alpine")).toBe("nginx:alpine");
  });
  test("leaves other registries alone", () => {
    expect(shortenImageName("quay.io/podman/hello")).toBe("quay.io/podman/hello");
  });
});

describe("formatBytes", () => {
  test("formats with SI units to match podman", () => {
    expect(formatBytes(0)).toBe("0B");
    expect(formatBytes(8715873)).toBe("8.7MB");
    expect(formatBytes(64322556)).toBe("64.3MB");
  });
});

describe("Panel rendering (ink-testing-library)", () => {
  const items = [
    { id: "a", label: "web", status: "running" },
    { id: "b", label: "chatty", status: "running" },
    { id: "c", label: "failing", status: "exited" },
  ];

  test("renders one row per item, each on its own line", () => {
    const { lastFrame } = render(
      <Panel
        title="Containers"
        number={2}
        isFocused
        isVisible
        items={items}
        selectedIndex={0}
        onSelect={noop}
        _onToggle={noop}
        innerWidth={30}
        maxRows={10}
      />,
    );
    const frame = lastFrame() ?? "";
    const lines = frame.split("\n");
    // title row + 3 data rows
    expect(lines.some((l) => l.includes("[2] Containers"))).toBe(true);
    expect(lines.filter((l) => l.includes("web")).length).toBeGreaterThan(0);
    expect(lines.filter((l) => l.includes("chatty")).length).toBeGreaterThan(0);
    expect(lines.filter((l) => l.includes("failing")).length).toBeGreaterThan(0);
  });

test("long names stay on one line instead of stacking into columns", () => {
    const { lastFrame } = render(
      <Panel
        title="Images"
        number={3}
        isFocused
        isVisible
        items={[{ id: "x", label: "docker.io/library/nginx:alpine", status: "64.3MB" }]}
        selectedIndex={0}
        onSelect={noop}
        _onToggle={noop}
        innerWidth={30}
        maxRows={10}
      />,
    );
    const lines = (lastFrame() ?? "").split("\n");
    // The (truncated) name and its status must share a single line, not stack vertically.
    const dataLine = lines.find((l) => l.includes("…"));
    expect(dataLine).toBeDefined();
    expect(dataLine).toContain("64.3MB");
    // No per-character stacking: the header must occupy its own line.
    expect(lines.filter((l) => l.includes("Images")).length).toBe(1);
  });

  test("empty panel shows (empty) and does not crash", () => {
    const { lastFrame } = render(
      <Panel
        title="Quadlets"
        number={6}
        isFocused={false}
        isVisible
        items={[]}
        selectedIndex={0}
        onSelect={noop}
        _onToggle={noop}
        innerWidth={30}
        maxRows={5}
      />,
    );
    expect(lastFrame() ?? "").toContain("(empty)");
  });

  test("hidden panel renders nothing", () => {
    const { lastFrame } = render(
      <Panel
        title="Pods"
        number={1}
        isFocused={false}
        isVisible={false}
        items={items}
        selectedIndex={0}
        onSelect={noop}
        _onToggle={noop}
        innerWidth={30}
        maxRows={5}
      />,
    );
    expect((lastFrame() ?? "").trim()).toBe("");
  });

  test("maxRows windows long lists", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: String(i), label: `c${i}`, status: "running" }));
    const { lastFrame } = render(
      <Panel
        title="Containers"
        number={2}
        isFocused
        isVisible
        items={many}
        selectedIndex={20}
        onSelect={noop}
        _onToggle={noop}
        innerWidth={30}
        maxRows={4}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame.includes("c20")).toBe(true);
    expect(frame.includes("c0 ")).toBe(false);
  });
});