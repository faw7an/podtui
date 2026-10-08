/**
 * Item actions and the confirm dialog (P4-T5, P4-T6).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  confirmContent,
  needsConfirm,
  runAction,
  VERBS,
  type ResourceAction,
  type ResourceKind,
} from "../src/ui/actions/resourceActions.ts";
import { actionFor, failureContent } from "../src/ui/actions/selectionAction.ts";
import { dialogKey, openConfirm, openMessage } from "../src/ui/view/confirmDialog.ts";
import { dialogRect, renderConfirmDialog, wrapText } from "../src/ui/render/confirmDialog.ts";
import { EMPTY_DATA, type ResourceData } from "../src/ui/view/build.ts";
import { displayWidth } from "../src/util/fit.ts";
import { stripAnsi } from "../src/ui/render/palette.ts";
import { defaultTheme } from "../src/theme/theme.ts";

const fx = (f: string) => JSON.parse(readFileSync(`test/fixtures/${f}`, "utf8"));
const data: ResourceData = {
  ...EMPTY_DATA,
  containers: fx("containers-list.json"),
  pods: fx("pods-list.json"),
  images: fx("images-list.json"),
  volumes: fx("volumes-list.json"),
  networks: fx("networks-list.json"),
};

/** Records every engine call as `method(args…)`. */
function recordingEngine() {
  const calls: string[] = [];
  const ok = (name: string) => (_s: string, ...args: unknown[]) => {
    calls.push(`${name}(${args.map(String).join(",")})`);
    return Promise.resolve({ success: true });
  };
  const methods = [
    "startContainer", "stopContainer", "restartContainer", "killContainer", "removeContainer",
    "startPod", "stopPod", "restartPod", "killPod", "removePod",
    "removeImage", "removeVolume", "removeNetwork",
  ] as const;
  const engine = Object.fromEntries(methods.map((m) => [m, ok(m)])) as unknown as Parameters<typeof runAction>[0];
  return { engine, calls };
}

describe("runAction calls the right engine method with the right id", () => {
  const cases: [ResourceAction, string][] = [
    [{ kind: "container", verb: "start", id: "c1", name: "web" }, "startContainer(c1)"],
    [{ kind: "container", verb: "stop", id: "c1", name: "web" }, "stopContainer(c1)"],
    [{ kind: "container", verb: "restart", id: "c1", name: "web" }, "restartContainer(c1)"],
    [{ kind: "container", verb: "kill", id: "c1", name: "web" }, "killContainer(c1)"],
    [{ kind: "container", verb: "remove", id: "c1", name: "web" }, "removeContainer(c1,false)"],
    [{ kind: "container", verb: "remove", id: "c1", name: "web", force: true }, "removeContainer(c1,true)"],
    [{ kind: "pod", verb: "start", id: "p1", name: "pod" }, "startPod(p1)"],
    [{ kind: "pod", verb: "stop", id: "p1", name: "pod" }, "stopPod(p1)"],
    [{ kind: "pod", verb: "restart", id: "p1", name: "pod" }, "restartPod(p1)"],
    [{ kind: "pod", verb: "kill", id: "p1", name: "pod" }, "killPod(p1)"],
    [{ kind: "pod", verb: "remove", id: "p1", name: "pod", force: true }, "removePod(p1,true)"],
    // Never forced, even if a caller asks: forcing these takes containers along.
    [{ kind: "image", verb: "remove", id: "i1", name: "nginx", force: true }, "removeImage(i1,false)"],
    [{ kind: "volume", verb: "remove", id: "vol", name: "vol" }, "removeVolume(vol)"],
    [{ kind: "network", verb: "remove", id: "n1", name: "net" }, "removeNetwork(n1)"],
  ];
  test.each(cases)("%o → %s", async (action, call) => {
    const { engine, calls } = recordingEngine();
    await runAction(engine, "/tmp/podtui-test/x.sock", action);
    expect(calls).toEqual([call]);
  });

  test("an unsupported verb is rejected without any engine call", async () => {
    const { engine, calls } = recordingEngine();
    await expect(runAction(engine, "/x", { kind: "image", verb: "start", id: "i", name: "i" })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("confirmation policy", () => {
  test("remove and kill ask first; start/stop/restart do not", () => {
    for (const kind of Object.keys(VERBS) as ResourceKind[]) {
      for (const verb of VERBS[kind]) {
        expect(needsConfirm({ kind, verb, id: "x", name: "x" })).toBe(verb === "remove" || verb === "kill");
      }
    }
  });
});

describe("actionFor (selected row + key)", () => {
  const web = data.containers.find((c) => c.Names?.[0] === "web")!;
  const failing = data.containers.find((c) => c.Names?.[0] === "failing")!;
  const pod = data.pods[0]!;

  test("start a container runs at once", () => {
    expect(actionFor("containers", failing.Id, "start", data, "failing")).toEqual({
      kind: "run",
      action: { kind: "container", verb: "start", id: failing.Id, name: "failing", force: false },
    });
  });

  test("removing a RUNNING container is forced, and the dialog says it will be stopped", () => {
    const r = actionFor("containers", web.Id, "remove", data, "web");
    expect(r.kind).toBe("confirm");
    if (r.kind !== "confirm") return;
    expect(r.action.force).toBe(true);
    expect(r.content.lines).toContain("It is running: it will be stopped first.");
  });

  test("removing a stopped container is not forced", () => {
    const r = actionFor("containers", failing.Id, "remove", data, "failing");
    expect(r.kind === "confirm" && r.action.force).toBe(false);
  });

  test("removing a pod names every member container (infra included) and forces", () => {
    const r = actionFor("pods", pod.Id, "remove", data, "web-pod");
    expect(r.kind).toBe("confirm");
    if (r.kind !== "confirm") return;
    expect(r.action.force).toBe(true);
    const text = r.content.lines.join(" ");
    for (const m of pod.Containers) expect(text).toContain(m.Names);
    expect(text).toContain("Also removes its 3 containers");
  });

  test("images, volumes and networks: remove only, never forced", () => {
    const img = data.images[0]!;
    const r = actionFor("images", img.Id, "remove", data, "nginx:alpine");
    expect(r.kind === "confirm" && r.action.force).toBeFalsy();
    expect(actionFor("images", img.Id, "stop", data, "x")).toEqual({ kind: "refuse", message: "Images can only be removed (d)." });
  });

  test("quadlets, no selection and a vanished item are refused with a reason", () => {
    expect(actionFor("quadlets", "q", "start", data, "q").kind).toBe("refuse");
    expect(actionFor("containers", "", "start", data, "").kind).toBe("refuse");
    expect(actionFor("containers", "gone", "start", data, "x")).toEqual({
      kind: "refuse",
      message: "That container is gone; the list will refresh.",
    });
  });
});

describe("dialog keys", () => {
  const action: ResourceAction = { kind: "container", verb: "remove", id: "c1", name: "web" };
  const open = openConfirm(action, confirmContent(action));

  test("focus starts on Cancel, so Enter alone never confirms", () => {
    expect(open.focus).toBe("cancel");
    expect(dialogKey(open, "", { return: true })).toEqual({ type: "cancel" });
  });

  test("y confirms; n and Esc cancel", () => {
    expect(dialogKey(open, "y", {})).toEqual({ type: "confirm", action });
    expect(dialogKey(open, "n", {})).toEqual({ type: "cancel" });
    expect(dialogKey(open, "", { escape: true })).toEqual({ type: "cancel" });
  });

  test("Tab moves focus to the confirm button; then Enter confirms", () => {
    const moved = dialogKey(open, "", { tab: true });
    expect(moved.type).toBe("focus");
    if (moved.type !== "focus") return;
    expect(dialogKey(moved.state, "", { return: true })).toEqual({ type: "confirm", action });
  });

  test("everything else is swallowed", () => {
    for (const input of ["d", "q", "s", "1", "/"]) expect(dialogKey(open, input, {})).toEqual({ type: "ignore" });
  });
});

describe("dialog render", () => {
  const action: ResourceAction = { kind: "pod", verb: "remove", id: "p", name: "web-pod" };
  const members = Array.from({ length: 12 }, (_, i) => `member-container-${i}`);
  const state = openConfirm(action, confirmContent(action, { members, running: true }));

  test("exact size, every member named (wrapped, not cut)", () => {
    const rect = dialogRect(100, 30, state)!;
    const out = renderConfirmDialog(rect, state, defaultTheme, true);
    expect(out).toHaveLength(rect.h);
    for (const line of out) expect(displayWidth(line)).toBe(rect.w);
    const text = stripAnsi(out.join(" ")).replace(/[│ ]+/g, " ");
    for (const m of members) expect(text).toContain(m);
    expect(text).toContain("[ Cancel ]");
    expect(text).toContain("[ Remove ]");
  });

  test("without colour the focused button is marked", () => {
    const rect = dialogRect(100, 30, state)!;
    expect(renderConfirmDialog(rect, state, defaultTheme, false).join("\n")).toContain(">[ Cancel ]");
  });

  test("a terminal too small for the box gets no rect (the frame shows a footer prompt)", () => {
    expect(dialogRect(28, 10, state)).toBeNull();
  });

  test("wrapText keeps words whole and hard-splits only overlong words", () => {
    expect(wrapText("a bb ccc", 4)).toEqual(["a bb", "ccc"]);
    expect(wrapText("abcdefgh", 3)).toEqual(["abc", "def", "gh"]);
  });
});

describe("failure dialog (phase-4/error-dialog)", () => {
  const reports = JSON.parse(readFileSync("test/fixtures/remove-reports.json", "utf8")) as Record<string, { body: string }>;
  const msg = (name: string): string => (JSON.parse(reports[name]!.body) as { message: string }).message;

  test("volume in use: container ids become names, with what to do next", () => {
    const users: ResourceData = {
      ...data,
      containers: [{ ...data.containers[0]!, Id: "4a9a786d2077da742de949d312a1250c88420fcc052ddced580d8dbffd867407", Names: ["probe-vr"] }],
    };
    const c = failureContent({ kind: "volume", verb: "remove", id: "probe-vol-run", name: "probe-vol-run" }, msg("volumeInUse409"), users);
    expect(c.title).toBe("Could not remove volume probe-vol-run");
    expect(c.lines[0]).toBe("volume probe-vol-run is being used by the following container(s): probe-vr: volume is being used");
    expect(c.lines[1]).toContain("Remove probe-vr first");
  });

  test("image in use: explains why podtui does not force", () => {
    const c = failureContent({ kind: "image", verb: "remove", id: "i", name: "alpine:latest" }, msg("imageInUse409"), data);
    expect(c.lines[0]).not.toMatch(/[0-9a-f]{64}/);
    expect(c.lines[1]).toContain("never force-removes images");
  });

  test("default network", () => {
    const c = failureContent({ kind: "network", verb: "remove", id: "podman", name: "podman" }, "default network podman cannot be removed", data);
    expect(c.lines).toEqual(["default network podman cannot be removed", "Podman's default network always stays."]);
  });

  test("a message box closes on Enter/Esc/Space/y/n and swallows everything else", () => {
    const box = openMessage("Could not remove volume v", ["busy"]);
    for (const [input, key] of [["", { return: true }], ["", { escape: true }], [" ", {}], ["y", {}], ["n", {}]] as const) {
      expect(dialogKey(box, input, key)).toEqual({ type: "cancel" });
    }
    for (const input of ["d", "s", "1", "/"]) expect(dialogKey(box, input, {})).toEqual({ type: "ignore" });
  });

  test("renders one focused OK button and a close hint", () => {
    const box = openMessage("Could not remove volume v", ["volume v is being used by the following container(s): web: volume is being used"]);
    const rect = dialogRect(80, 24, box)!;
    const out = renderConfirmDialog(rect, box, defaultTheme, false);
    for (const line of out) expect(displayWidth(line)).toBe(rect.w);
    const text = out.join("\n");
    expect(text).toContain(">[ OK ]");
    expect(text).not.toContain("Cancel");
    expect(text).toContain("Enter/Esc close");
  });
});
