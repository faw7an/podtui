/**
 * Quadlets (P6): file helpers, systemctl/journal parsers (fixtures recorded
 * from this machine's systemd 259 and Podman 5.8.4), and the systemd calls
 * through a fake runner — tests never spawn the real systemctl.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { QuadletListItem } from "../src/api/types.ts";
import { iniLine, iniValue, quadletContainerName, quadletType, QUADLET_LABEL } from "../src/engine/quadlet.ts";
import {
  daemonReload,
  describeState,
  followJournal,
  parseJournalLine,
  parseSystemctlShow,
  unitAction,
  unitStates,
  unitText,
  type CommandRunner,
} from "../src/engine/systemd.ts";

const list = JSON.parse(readFileSync("test/fixtures/quadlets-list.json", "utf8")) as QuadletListItem[];

function fakeRunner(reply: (argv: string[]) => { code?: number; out?: string; err?: string } = () => ({}), lines: string[] = []) {
  const calls: string[] = [];
  const runner: CommandRunner = {
    run: async (argv) => {
      calls.push(argv.join(" "));
      const r = reply(argv);
      return { code: r.code ?? 0, out: r.out ?? "", err: r.err ?? "" };
    },
    async *lines(argv, signal) {
      calls.push(argv.join(" "));
      for (const l of lines) {
        if (signal.aborted) return;
        yield l;
      }
    },
  };
  return { runner, calls };
}

describe("quadlet files", () => {
  test("types and labels from the extension", () => {
    expect(list.map((q) => quadletType(q.Name))).toEqual(["volume", "pod", "container", "container", "container"]);
    expect(QUADLET_LABEL[quadletType("x.kube")]).toBe("kube");
    expect(quadletType("notes.txt")).toBe("other");
  });

  test("Podman's UnitName is used as-is, overrides included (fixture)", () => {
    expect(list.find((q) => q.Name === "named.container")?.UnitName).toBe("custom-name.service");
    expect(list.find((q) => q.Name === "data.volume")?.UnitName).toBe("data-volume.service");
  });

  test("container name: systemd-%N by default, ContainerName= when set (generator dry run)", () => {
    expect(quadletContainerName("hello.container", "hello.service", "[Container]\nImage=x\n")).toBe("systemd-hello");
    expect(quadletContainerName("named.container", "custom-name.service", "[Container]\nImage=x\n")).toBe("systemd-custom-name");
    expect(quadletContainerName("boxed.container", "boxed.service", "[Container]\nContainerName=my-box\n")).toBe("my-box");
    expect(quadletContainerName("data.volume", "data-volume.service", "")).toBeNull();
  });

  test("iniValue reads the right section, ignores comments, last wins", () => {
    const text = "# ContainerName=no\n[Service]\nContainerName=wrong\n[Container]\nContainerName = a\nContainerName=b\n";
    expect(iniValue(text, "Container", "ContainerName")).toBe("b");
    expect(iniValue(text, "Container", "Image")).toBeUndefined();
  });

  test("iniLine classifies for colouring", () => {
    expect(iniLine("[Container]").kind).toBe("section");
    expect(iniLine("Image=docker.io/x").kind).toBe("key");
    expect(iniLine("Image=docker.io/x").keyEnd).toBe(5);
    expect(iniLine("# comment").kind).toBe("comment");
    expect(iniLine("  continued line").kind).toBe("plain");
  });
});

describe("systemctl show", () => {
  test("parses the recorded output into states by unit", () => {
    const m = parseSystemctlShow(readFileSync("test/fixtures/systemctl-show.txt", "utf8"));
    expect(m.get("pipewire.service")).toEqual({ id: "pipewire.service", load: "loaded", active: "active", sub: "running" });
    expect(describeState(m.get("pipewire.service"))).toBe("active (running)");
    expect(describeState(m.get("nope-xyz.service"))).toBe("not loaded");
    expect(describeState(undefined)).toBe("unknown");
  });

  test("user scope passes --user; system scope does not", async () => {
    const { runner, calls } = fakeRunner(() => ({ out: readFileSync("test/fixtures/systemctl-show.txt", "utf8") }));
    await unitStates(runner, "user", ["a.service", "b.service"]);
    await unitStates(runner, "system", ["a.service"]);
    expect(calls).toEqual([
      "systemctl --user show a.service b.service -p Id,LoadState,ActiveState,SubState",
      "systemctl show a.service -p Id,LoadState,ActiveState,SubState",
    ]);
  });

  test("no units, no call", async () => {
    const { runner, calls } = fakeRunner();
    expect((await unitStates(runner, "user", [])).size).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe("actions", () => {
  test("start/stop/restart and daemon-reload run the expected commands", async () => {
    const { runner, calls } = fakeRunner();
    await unitAction(runner, "user", "start", "hello.service");
    await unitAction(runner, "user", "stop", "hello.service");
    await unitAction(runner, "system", "restart", "hello.service");
    await daemonReload(runner, "user");
    expect(calls).toEqual([
      "systemctl --user start hello.service",
      "systemctl --user stop hello.service",
      "systemctl restart hello.service",
      "systemctl --user daemon-reload",
    ]);
  });

  test("a failing systemctl becomes an error carrying its stderr", async () => {
    const { runner } = fakeRunner(() => ({ code: 5, err: "Failed to start hello.service: Unit hello.service not found.\n" }));
    await expect(unitAction(runner, "user", "start", "hello.service")).rejects.toThrow(
      "systemctl start hello.service: Failed to start hello.service: Unit hello.service not found.",
    );
  });

  test("unit text: status is shown even when it exits 3 (inactive)", async () => {
    const { runner } = fakeRunner((argv) =>
      argv.includes("status") ? { code: 3, out: "○ hello.service\n     Active: inactive (dead)\n" } : { out: "[Unit]\n" },
    );
    const t = await unitText(runner, "user", "hello.service");
    expect(t.cat).toBe("[Unit]\n");
    expect(t.status).toContain("inactive (dead)");
  });
});

describe("journal", () => {
  const fixture = readFileSync("test/fixtures/journal-user-unit.jsonl", "utf8").trim().split("\n");

  test("recorded lines parse: message, priority, µs timestamp", () => {
    const e = parseJournalLine(fixture[0]!)!;
    expect(e.message).toBe("Stopped pipewire.service - PipeWire Multimedia Service.");
    expect(e.priority).toBe(6);
    expect(e.timestamp.getTime()).toBe(Math.floor(1791314014767061 / 1000));
  });

  test("byte-array messages decode; junk is skipped", () => {
    expect(parseJournalLine(JSON.stringify({ MESSAGE: [104, 105], PRIORITY: "3" }))).toMatchObject({ message: "hi", priority: 3 });
    expect(parseJournalLine("not json")).toBeNull();
    expect(parseJournalLine("")).toBeNull();
  });

  test("followJournal asks for the unit, follows, json, and stops on abort", async () => {
    const { runner, calls } = fakeRunner(() => ({}), fixture);
    const c = new AbortController();
    const got: string[] = [];
    for await (const e of followJournal(runner, "user", "hello.service", c.signal, 50)) {
      got.push(e.message);
      if (got.length === 2) c.abort();
    }
    expect(got).toHaveLength(2);
    expect(calls).toEqual(["journalctl --user -u hello.service -f -n 50 -o json --no-pager"]);
  });
});
