import { test, expect, describe } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ContainerListItem,
  ContainerInspect,
  ContainerTop,
  PodListItem,
  PodInspect,
  ImageListItem,
  VolumeListItem,
  NetworkListItem,
  VersionInfo,
  Info,
  ContainersStatsResponse,
} from "../src/api/types.ts";

const FIXTURE_DIR = path.join(import.meta.dirname, "fixtures");

function readFixture<T>(filename: string): T {
  const content = fs.readFileSync(path.join(FIXTURE_DIR, filename), "utf-8");
  return JSON.parse(content) as T;
}

describe("fixtures parse correctly into types", () => {
  test("containers-list.json parses as ContainerListItem[]", () => {
    const data = readFixture<ContainerListItem[]>("containers-list.json");
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.Id).toBeDefined();
      expect(item.Names).toBeDefined();
      expect(item.Image).toBeDefined();
      expect(item.State).toBeDefined();
    }
  });

  test("containers-list-running.json parses as ContainerListItem[]", () => {
    const data = readFixture<ContainerListItem[]>("containers-list-running.json");
    expect(Array.isArray(data)).toBe(true);
  });

  test("container-inspect.json parses as ContainerInspect", () => {
    const data = readFixture<ContainerInspect>("container-inspect.json");
    expect(data.Id).toBeDefined();
    expect(data.State).toBeDefined();
    expect(data.State.Running).toBeDefined();
    expect(data.Config).toBeDefined();
    expect(data.HostConfig).toBeDefined();
    expect(data.NetworkSettings).toBeDefined();
  });

  test("container-top.json parses as ContainerTop", () => {
    const data = readFixture<ContainerTop>("container-top.json");
    expect(data.Titles).toBeDefined();
    expect(Array.isArray(data.Titles)).toBe(true);
    expect(data.Processes).toBeDefined();
    expect(Array.isArray(data.Processes)).toBe(true);
    expect(data.Processes.length).toBeGreaterThan(0);
  });

  test("pods-list.json parses as PodListItem[]", () => {
    const data = readFixture<PodListItem[]>("pods-list.json");
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.Id).toBeDefined();
      expect(item.Name).toBeDefined();
      expect(item.Status).toBeDefined();
      expect(item.Containers).toBeDefined();
    }
  });

  test("pod-inspect.json parses as PodInspect", () => {
    const data = readFixture<PodInspect>("pod-inspect.json");
    expect(data.Id).toBeDefined();
    expect(data.Name).toBeDefined();
    expect(data.Containers).toBeDefined();
  });

  test("images-list.json parses as ImageListItem[]", () => {
    const data = readFixture<ImageListItem[]>("images-list.json");
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.Id).toBeDefined();
      expect(item.RepoTags).toBeDefined();
      expect(item.Size).toBeDefined();
    }
  });

  test("volumes-list.json parses as VolumeListItem[]", () => {
    const data = readFixture<VolumeListItem[]>("volumes-list.json");
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.Name).toBeDefined();
      expect(item.Driver).toBeDefined();
      expect(item.Mountpoint).toBeDefined();
    }
  });

  test("networks-list.json parses as NetworkListItem[]", () => {
    const data = readFixture<NetworkListItem[]>("networks-list.json");
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.name).toBeDefined();
      expect(item.id).toBeDefined();
      expect(item.driver).toBeDefined();
    }
  });

  test("containers-stats.json parses as ContainersStatsResponse", () => {
    const data = readFixture<ContainersStatsResponse>("containers-stats.json");
    expect(data.Error).toBeNull();
    expect(Array.isArray(data.Stats)).toBe(true);
    expect(data.Stats.length).toBeGreaterThan(0);
    for (const stat of data.Stats) {
      expect(stat.ContainerID).toBeDefined();
      expect(stat.Name).toBeDefined();
      expect(typeof stat.AvgCPU).toBe("number");
      expect(typeof stat.MemUsage).toBe("number");
      expect(typeof stat.MemLimit).toBe("number");
    }
  });

  test("version.json parses as VersionInfo", () => {
    const data = readFixture<VersionInfo>("version.json");
    expect(data.Version).toBeDefined();
    expect(data.ApiVersion).toBeDefined();
    expect(data.Components).toBeDefined();
  });

  test("info.json parses as Info", () => {
    const data = readFixture<Info>("info.json");
    expect(data.host).toBeDefined();
    expect(data.store).toBeDefined();
    expect(data.version).toBeDefined();
  });
});