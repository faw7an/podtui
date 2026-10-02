import {
  get,
  post,
  del,
  streamJson,
  streamLines,
  EngineError,
} from "../api/client.ts";
import {
  MultiplexedLogDecoder,
} from "../api/demux.ts";
import type {
  ContainerListItem,
  ContainerInspect,
  ContainerStats,
  ContainerTop,
  PodListItem,
  PodInspect,
  ImageListItem,
  ImageInspect,
  VolumeListItem,
  VolumeInspect,
  NetworkListItem,
  NetworkInspect,
  VersionInfo,
  Info,
  ContainerStatsUI,
} from "../api/types.ts";
import type {
  ContainerEngine,
  PrunePreview,
  PruneResult,
} from "./ContainerEngine.ts";

function mapContainerStats(stats: ContainerStats[]): ContainerStatsUI[] {
  return stats.map((s) => ({
    cpuPercent: s.AvgCPU * 100,
    memUsage: s.MemUsage,
    memLimit: s.MemLimit,
    memPercent: s.MemPerc * 100,
    netRx: s.Network ? Object.values(s.Network).reduce((sum, n) => sum + (n.RxBytes || 0), 0) : 0,
    netTx: s.Network ? Object.values(s.Network).reduce((sum, n) => sum + (n.TxBytes || 0), 0) : 0,
    blockRead: s.BlockInput || 0,
    blockWrite: s.BlockOutput || 0,
    pids: s.PIDs || 0,
  }));
}

function mapPrunePreview(raw: unknown, resource: string): PrunePreview {
  const key = resource.charAt(0).toLowerCase() + resource.slice(1) + "s";
  // API returns either { Containers: [...] } or [] directly
  let items: Record<string, unknown>[] = [];
  if (Array.isArray(raw)) {
    items = raw as Record<string, unknown>[];
  } else if (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>)[`${resource}s`])) {
    items = (raw as Record<string, unknown>)[`${resource}s`] as Record<string, unknown>[];
  }
  return {
    [key]: { count: items.length, names: items.map((r) => String(r["Name"] || r["Id"] || "")) },
  } as PrunePreview;
}

function mapPruneResult(raw: unknown, resource: string): PruneResult {
  const key = resource.charAt(0).toLowerCase() + resource.slice(1) + "s";
  // API returns either { Containers: [...] } or [] directly
  let items: Record<string, unknown>[] = [];
  if (Array.isArray(raw)) {
    items = raw as Record<string, unknown>[];
  } else if (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>)[`${resource}s`])) {
    items = (raw as Record<string, unknown>)[`${resource}s`] as Record<string, unknown>[];
  }
  return {
    [key]: {
      count: items.length,
      names: items.map((r) => String(r["Name"] || r["Id"] || "")),
      reclaimedBytes: items.reduce((sum, r) => sum + Number(r["Size"] || 0), 0),
    },
  } as PruneResult;
}

export function createPodmanEngine(): ContainerEngine {
  return {
    async findSocket(cliSocket?: string) {
      const { discoverSocket } = await import("../api/socket.ts");
      return discoverSocket(cliSocket);
    },

    async ping(socketPath: string) {
      const { pingSocket } = await import("../api/socket.ts");
      return pingSocket(socketPath);
    },

    async getVersion(socketPath: string) {
      return get<VersionInfo>(socketPath, "/version");
    },

    async getInfo(socketPath: string) {
      return get<Info>(socketPath, "/info");
    },

    // Containers
    async listContainers(socketPath: string, all = true) {
      return get<ContainerListItem[]>(socketPath, "/containers/json", {
        query: { all: all.toString() },
      });
    },

    async inspectContainer(socketPath: string, id: string) {
      return get<ContainerInspect>(socketPath, `/containers/${id}/json`);
    },

    async containerTop(socketPath: string, id: string) {
      return get<ContainerTop>(socketPath, `/containers/${id}/top`);
    },

    async containerStats(socketPath: string, ids: string[], stream = false): Promise<ContainerStats[] | AsyncGenerator<ContainerStatsUI>> {
      if (ids.length === 0) {
        if (stream) {
          const never = false;
          return Promise.resolve((async function* () { if (never) yield undefined as never; })());
        }
        return Promise.resolve([]);
      }
      const containerParam = ids.length === 1 ? ids[0]! : ids.join(",");
      const queryString = `containers=${encodeURIComponent(containerParam)}`;
      if (stream) {
        return Promise.resolve((async function* (): AsyncGenerator<ContainerStatsUI> {
          for await (const line of streamLines(socketPath, `/containers/stats?${queryString}&stream=true`, {})) {
            try {
              const response = JSON.parse(line);
              if (response.Stats && Array.isArray(response.Stats)) {
                for (const stat of response.Stats) {
                  const mapped = mapContainerStats([stat])[0];
                  if (mapped) yield mapped;
                }
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        })());
      }
      return get<{ Stats: ContainerStats[] }>(socketPath, "/containers/stats", {
        query: { containers: containerParam, stream: "false" },
      }).then(raw => raw.Stats);
    },

    async *containerLogs(socketPath: string, id: string, options = {}) {
      const { follow = true, tail = 100, timestamps = true } = options;
      const query = `stdout=true&stderr=true&follow=${follow}&tail=${tail}&timestamps=${timestamps}`;
      
      const decoder = new MultiplexedLogDecoder();
      
      for await (const line of streamLines(socketPath, `/containers/${id}/logs?${query}`)) {
        const chunk = new TextEncoder().encode(line + "\n");
        decoder.append(chunk);
        const frames = decoder.decode();
        for (const frame of frames) {
          yield frame;
        }
      }
    },

    async startContainer(socketPath: string, id: string) {
      await post(socketPath, `/containers/${id}/start`, {});
      return { success: true };
    },

    async stopContainer(socketPath: string, id: string, timeout = 30) {
      await post(socketPath, `/containers/${id}/stop`, {}, { query: { t: timeout.toString() }, timeout: timeout * 1000 + 5000 });
      return { success: true };
    },

    async restartContainer(socketPath: string, id: string, timeout = 10) {
      await post(socketPath, `/containers/${id}/restart`, {}, { query: { t: timeout.toString() } });
      return { success: true };
    },

    async killContainer(socketPath: string, id: string, signal = "SIGKILL") {
      await post(socketPath, `/containers/${id}/kill`, {}, { query: { signal } });
      return { success: true };
    },

    async removeContainer(socketPath: string, id: string, force = false) {
      await del(socketPath, `/containers/${id}`, { query: { force: force.toString() } });
      return { success: true };
    },

    async pruneContainers(socketPath: string, dryRun = false) {
      const raw = await post<unknown>(socketPath, "/containers/prune", dryRun ? { dryRun: true } : {});
      if (dryRun) {
        return mapPrunePreview(raw, "Container");
      }
      return mapPruneResult(raw, "Container");
    },

    // Pods
    async listPods(socketPath: string) {
      return get<PodListItem[]>(socketPath, "/pods/json");
    },

    async inspectPod(socketPath: string, id: string) {
      return get<PodInspect>(socketPath, `/pods/${id}/json`);
    },

    async startPod(socketPath: string, id: string) {
      await post(socketPath, `/pods/${id}/start`, {});
      return { success: true };
    },

    async stopPod(socketPath: string, id: string) {
      await post(socketPath, `/pods/${id}/stop`, {});
      return { success: true };
    },

    async restartPod(socketPath: string, id: string) {
      await post(socketPath, `/pods/${id}/restart`, {});
      return { success: true };
    },

    async killPod(socketPath: string, id: string) {
      await post(socketPath, `/pods/${id}/kill`, {});
      return { success: true };
    },

    async removePod(socketPath: string, id: string, force = false) {
      await del(socketPath, `/pods/${id}`, { query: { force: force.toString() } });
      return { success: true };
    },

    // Images
    async listImages(socketPath: string, all = false) {
      return get<ImageListItem[]>(socketPath, "/images/json", { query: { all: all.toString() } });
    },

    async inspectImage(socketPath: string, id: string) {
      return get<ImageInspect>(socketPath, `/images/${id}/json`);
    },

    async imageHistory(socketPath: string, id: string) {
      return get<unknown[]>(socketPath, `/images/${id}/history`);
    },

    async removeImage(socketPath: string, id: string, force = false) {
      await del(socketPath, `/images/${id}`, { query: { force: force.toString() } });
      return { success: true };
    },

    async pruneImages(socketPath: string, dryRun = false) {
      const raw = await post<unknown>(socketPath, "/images/prune", dryRun ? { dryRun: true } : {});
      if (dryRun) {
        return mapPrunePreview(raw, "Image");
      }
      return mapPruneResult(raw, "Image");
    },

    // Volumes
    async listVolumes(socketPath: string) {
      return get<VolumeListItem[]>(socketPath, "/volumes/json");
    },

    async inspectVolume(socketPath: string, name: string) {
      return get<VolumeInspect>(socketPath, `/volumes/${name}/json`);
    },

    async removeVolume(socketPath: string, name: string) {
      await del(socketPath, `/volumes/${name}`);
      return { success: true };
    },

    async pruneVolumes(socketPath: string, dryRun = false) {
      const raw = await post<unknown>(socketPath, "/volumes/prune", dryRun ? { dryRun: true } : {});
      if (dryRun) {
        return mapPrunePreview(raw, "Volume");
      }
      return mapPruneResult(raw, "Volume");
    },

    // Networks
    async listNetworks(socketPath: string) {
      return get<NetworkListItem[]>(socketPath, "/networks/json");
    },

    async inspectNetwork(socketPath: string, id: string) {
      return get<NetworkInspect>(socketPath, `/networks/${id}/json`);
    },

    async removeNetwork(socketPath: string, id: string) {
      await del(socketPath, `/networks/${id}`);
      return { success: true };
    },

    async pruneNetworks(socketPath: string, dryRun = false) {
      try {
        const raw = await post<unknown>(socketPath, "/networks/prune", dryRun ? { dryRun: true } : {});
        if (dryRun) {
          return mapPrunePreview(raw, "Network");
        }
        return mapPruneResult(raw, "Network");
      } catch (e: unknown) {
        // Network prune may not be available in all Podman versions
        if (e instanceof EngineError && e.statusCode === 404) {
          return dryRun 
            ? { networks: { count: 0, names: [] } } 
            : { networks: { count: 0, names: [], reclaimedBytes: 0 } };
        }
        throw e;
      }
    },

    // Events
    async *streamEvents(socketPath: string, filters = {}) {
      const queryParams = new URLSearchParams();
      for (const [key, values] of Object.entries(filters)) {
        for (const v of values) {
          queryParams.append(key, v);
        }
      }
      queryParams.append("stream", "true");
      
      for await (const event of streamJson(socketPath, `/events?${queryParams.toString()}`)) {
        yield event;
      }
    },

    isSandboxSocket(socketPath: string) {
      return socketPath.includes("/tmp/podtui-dev/") || socketPath.includes("/tmp/podtui-test/");
    },
  };
}