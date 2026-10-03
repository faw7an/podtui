import { describe, expect, test } from "bun:test";
import { initialState, reducer } from "../src/ui/layout/layoutReducer.ts";
import { buildFrameModel, EMPTY_DATA, type ResourceData } from "../src/ui/view/build.ts";
import type { ContainerListItem } from "../src/api/types.ts";
import type { VolumeListItem } from "../src/api/types.ts";

/**
 * P2-T5: `/` filters the focused list (all six panels, each with its own
 * remembered query).
 *
 * State lives in the reducer (`filterFor` = the panel capturing typing,
 * `filterQuery` = one query per panel); narrowing happens in
 * `buildPanelModels` before the stored selection ID resolves to a row, so
 * R-12's cursor stability and the detail pane follow automatically. The
 * query is echoed in the panel title (`Containers /web`), which is why the
 * footer filter hints only need `Esc`/`Enter` — `q` and `?` type characters
 * while filtering and must not be advertised as quit/help.
 */

function container(id: string, name: string): ContainerListItem {
  return {
    Id: id,
    Names: [`/${name}`],
    Image: "alpine:latest",
    ImageID: "img",
    Command: null,
    Created: "2026-10-03T07:24:54Z",
    State: "running",
    Status: "",
    Ports: null,
    Labels: {},
    Size: null,
    NetworkSettings: { Networks: {} },
    Mounts: [],
    IsInfra: false,
    Pod: "",
    PodName: "",
    RestartCount: 0,
    Pid: 1,
    ExitCode: 0,
    Exited: false,
    ExitedAt: 0,
    StartedAt: 0,
  };
}

function volume(name: string): VolumeListItem {
  return {
    Name: name,
    Driver: "local",
    Mountpoint: "/var/lib/containers/storage/volumes/" + name,
    CreatedAt: "2026-10-03T07:24:54Z",
    Labels: {},
    Scope: "local",
    Options: {},
    MountCount: 0,
    NeedsCopyUp: true,
    NeedsChown: true,
    LockNumber: 1,
  };
}

const DATA: ResourceData = {
  ...EMPTY_DATA,
  containers: [container("id-web", "web"), container("id-chatty", "chatty")],
  volumes: [volume("test-volume"), volume("data-volume")],
};

function selectedAll(firstContainerId: string): Record<"pods" | "containers" | "images" | "volumes" | "networks" | "quadlets", string> {
  return { pods: "", containers: firstContainerId, images: "", volumes: "", networks: "", quadlets: "" };
}

function names(panel: "containers" | "volumes", filter?: Partial<Record<"containers" | "volumes", string>>): string[] {
  const model = buildFrameModel({
    data: DATA,
    selected: selectedAll("id-web"),
    focus: "containers",
    now: 0,
    clock: "",
    filter: filter as never,
  });
  return (model.panels.find((p) => p.id === panel)?.items ?? []).map((i) => i.cells["name"] ?? "");
}

describe("filter reducer", () => {
  test("starts on the focused panel, not from detail", () => {
    const onList = reducer(initialState(), { type: "startFilter" });
    expect(onList.filterFor).toBe("containers");

    const inDetail = reducer({ ...initialState(), focus: "detail", detailFullscreen: true }, { type: "startFilter" });
    expect(inDetail.filterFor).toBeNull();
  });

  test("typing appends, including spaces and pasted text", () => {
    let s = reducer(initialState(), { type: "startFilter" });
    s = reducer(s, { type: "filterInput", text: "w" });
    s = reducer(s, { type: "filterInput", text: "eb app" });
    expect(s.filterQuery["containers"]).toBe("web app");
    expect(s.filterFor).toBe("containers");
  });

  test("input with no active filter is a no-op", () => {
    const s = reducer(initialState(), { type: "filterInput", text: "x" });
    expect(s.filterQuery["containers"]).toBeUndefined();
    expect(s.filterFor).toBeNull();
  });

  test("backspace drops the last grapheme, not the last code unit", () => {
    let s = reducer(initialState(), { type: "startFilter" });
    s = reducer(s, { type: "filterInput", text: "a👍" });
    s = reducer(s, { type: "filterBackspace" });
    expect(s.filterQuery["containers"]).toBe("a");
    expect(s.filterFor).toBe("containers");
  });

  test("backspacing an empty query stays in filter mode", () => {
    let s = reducer(initialState(), { type: "startFilter" });
    s = reducer(s, { type: "filterBackspace" });
    expect(s.filterFor).toBe("containers");
  });

  test("clear removes the query and leaves filter mode", () => {
    let s = reducer(initialState(), { type: "startFilter" });
    s = reducer(s, { type: "filterInput", text: "web" });
    s = reducer(s, { type: "clearFilter" });
    expect(s.filterQuery["containers"]).toBeUndefined();
    expect(s.filterFor).toBeNull();
  });

  test("end keeps the query and leaves filter mode", () => {
    let s = reducer(initialState(), { type: "startFilter" });
    s = reducer(s, { type: "filterInput", text: "web" });
    s = reducer(s, { type: "endFilter" });
    expect(s.filterQuery["containers"]).toBe("web");
    expect(s.filterFor).toBeNull();
  });

  test("each panel remembers its own query", () => {
    let s = reducer(initialState(), { type: "startFilter" });
    s = reducer(s, { type: "filterInput", text: "web" });
    s = reducer({ ...s, focus: "volumes" }, { type: "startFilter" });
    s = reducer(s, { type: "filterInput", text: "data" });
    expect(s.filterFor).toBe("volumes");
    expect(s.filterQuery["containers"]).toBe("web");
    expect(s.filterQuery["volumes"]).toBe("data");
  });
});

describe("filter narrows the lists", () => {
  test("a query narrows by name, case-insensitively", () => {
    expect(names("containers", { containers: "WEB" })).toEqual(["web"]);
    expect(names("containers", { containers: "chat" })).toEqual(["chatty"]);
  });

  test("no query shows everything", () => {
    expect(names("containers")).toEqual(["web", "chatty"]);
    expect(names("containers", {})).toEqual(["web", "chatty"]);
  });

  test("a query that matches nothing yields an empty panel, not a crash", () => {
    expect(names("containers", { containers: "zzz" })).toEqual([]);
  });

  test("queries are per-panel: filtering containers leaves volumes alone", () => {
    expect(names("volumes", { containers: "web" })).toEqual(["test-volume", "data-volume"]);
    expect(names("volumes", { volumes: "data" })).toEqual(["data-volume"]);
  });

  test("the stored selection ID survives filtering untouched", () => {
    // Cursor is on chatty; the filter hides it. The reducer state is the
    // source of truth here: filtering is view-only, so the ID must persist
    // and the cursor returns when the query clears.
    let s = reducer(initialState(), { type: "select", id: "containers", itemId: "id-chatty" });
    s = reducer(s, { type: "startFilter" });
    s = reducer(s, { type: "filterInput", text: "web" });
    const selected = { ...selectedAll(""), containers: "id-chatty" };
    const model = buildFrameModel({ data: DATA, selected, focus: "containers", now: 0, clock: "", filter: s.filterQuery as never });
    const panel = model.panels.find((p) => p.id === "containers");
    // Only web is visible, so the visible cursor falls back to row 0...
    expect(panel?.items.map((i) => i.cells["name"])).toEqual(["web"]);
    expect(panel?.selected).toBe(0);
    // ...but clearing the query restores the cursor to chatty, not row 0.
    const cleared = buildFrameModel({ data: DATA, selected, focus: "containers", now: 0, clock: "" });
    expect(cleared.panels.find((p) => p.id === "containers")?.selected).toBe(1);
  });

  test("the panel title echoes the query", () => {
    const model = buildFrameModel({
      data: DATA,
      selected: selectedAll("id-web"),
      focus: "containers",
      now: 0,
      clock: "",
      filter: { containers: "web" } as never,
    });
    const title = model.panels.find((p) => p.id === "containers")?.title ?? "";
    expect(title).toContain("/web");
    const unfiltered = buildFrameModel({ data: DATA, selected: selectedAll("id-web"), focus: "containers", now: 0, clock: "" });
    expect(unfiltered.panels.find((p) => p.id === "containers")?.title ?? "").not.toContain("/");
  });
});