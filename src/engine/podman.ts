import {
  get,
  post,
  postVoid,
  delVoid,
  streamChunks,
  streamJson,
  streamLines,
} from "../api/client.ts";
import {
  MultiplexedLogDecoder,
} from "../api/demux.ts";
import type {
  ImageHistoryEntry,
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
import type { VoidResult } from "../api/client.ts";
import { probeSocket, resolveSocket } from "../api/socket.ts";
import type {
  ContainerActionResult,
  ContainerEngine,
  PrunePreview,
} from "./ContainerEngine.ts";

/**
 * `CPU` is the LIVE value: CPU % over the last sample interval. `AvgCPU` is
 * the average since the container started. Measured on Podman 5.8.4 with a
 * container that idled, busy-looped 6 s, then idled, streamed at 5 s:
 * CPU 23 → 96 → 0.00 → 0.00 while AvgCPU went 23 → 59 → 40 → 30 (decaying
 * slowly). The Stats tab shows `cpuPercent` (live) and keeps the average as
 * `avgCpuPercent`. The mapper used AvgCPU before, which a live tab would have
 * shown as a slowly fading number long after a spike ended.
 *
 * Both, and `MemPerc`, are already PERCENTAGES, not fractions.
 * Verified live 2026-10-08 against `podman stats --no-stream` on Podman 5.8.4:
 * CLI "123.80%" ↔ API AvgCPU 123.78; CLI "0.11%" ↔ API MemPerc 0.105
 * (= MemUsage/MemLimit × 100). The earlier `× 100` turned a busy container's
 * 124% CPU into 12378%. Values pass through unchanged.
 */
export function mapContainerStats(stats: ContainerStats[]): ContainerStatsUI[] {
  return stats.map((s) => ({
    cpuPercent: s.CPU,
    avgCpuPercent: s.AvgCPU,
    memUsage: s.MemUsage,
    memLimit: s.MemLimit,
    memPercent: s.MemPerc,
    netRx: s.Network ? Object.values(s.Network).reduce((sum, n) => sum + (n.RxBytes || 0), 0) : 0,
    netTx: s.Network ? Object.values(s.Network).reduce((sum, n) => sum + (n.TxBytes || 0), 0) : 0,
    blockRead: s.BlockInput || 0,
    blockWrite: s.BlockOutput || 0,
    pids: s.PIDs || 0,
  }));
}

/**
 * One entry of a libpod prune response. Containers, images and volumes answer
 * `{Id, Size, Err?}`; networks answer `{Name, Error}` (verified live on 5.8.4).
 * `Err`/`Error` is a serialized Go `error`, which can arrive as a string, as
 * `{}` (Go marshals most error values to an empty object) or as null.
 */
interface RawPruneReport {
  Id?: string;
  Name?: string;
  Size?: number;
  Err?: unknown;
  Error?: unknown;
}

const SHORT_ID = /^[0-9a-f]{64}$/;

/** Full 64-hex IDs are shortened to 12 like the CLI; names pass through. */
function displayId(value: string): string {
  return SHORT_ID.test(value) ? value.slice(0, 12) : value;
}

function errorText(err: unknown): string | undefined {
  if (err === undefined || err === null) return undefined;
  if (typeof err === "string") return err || "removal failed";
  return "removal failed";
}

/**
 * Map a prune response to a result. Entries carrying an error are reported
 * under `failed` and are NOT counted as removed — the old mapper counted every
 * entry, so a partial failure read as a full success.
 */
export function mapPruneReports(raw: unknown): { count: number; names: string[]; reclaimedBytes: number; failed: { name: string; error: string }[] } {
  const items: RawPruneReport[] = Array.isArray(raw) ? (raw as RawPruneReport[]) : [];
  const names: string[] = [];
  const failed: { name: string; error: string }[] = [];
  let reclaimedBytes = 0;
  for (const item of items) {
    const name = displayId(String(item.Name ?? item.Id ?? ""));
    const error = errorText(item.Err ?? item.Error);
    if (error !== undefined) {
      failed.push({ name, error });
      continue;
    }
    names.push(name);
    reclaimedBytes += Number(item.Size ?? 0);
  }
  return { count: names.length, names, reclaimedBytes, failed };
}

/**
 * Prune PREVIEWS: what the real prune would remove, computed without removing
 * anything.
 *
 * The libpod prune endpoints have no dry-run mode (a `{dryRun:true}` body is
 * silently ignored and the prune really runs), so a preview must never POST.
 * Each preview reproduces the server's own selection rule, read from the
 * Podman v5.8.4 source and then verified by `test/prune-contract.test.ts`,
 * which runs the REAL prune on a throwaway service and asserts that exactly
 * the previewed set disappeared:
 *
 *   container  libpod/runtime_ctr.go PruneContainers: not in a pod, and state
 *              stopped | exited | created | configured (paused is kept).
 *   image      pkg/domain/infra/abi/images.go Prune: dangling (untagged, no
 *              children, not in a manifest list), not used by a container,
 *              repeated "until we converge" — removing a dangling image can
 *              orphan its untagged parent, which goes in the next round.
 *   volume     libpod/runtime_volume.go PruneVolumes: every volume the server
 *              can remove without force, i.e. not referenced by ANY container
 *              (stopped ones included). Named volumes are NOT spared — the
 *              previous "anonymous only" rule under-reported and let a prune
 *              delete named volumes the preview never mentioned.
 *   network    pkg/domain/infra/abi/network.go NetworkPrune: the `dangling`
 *              filter — no container (stopped included) references it, and
 *              never the default network.
 *
 * Volumes and networks use the server's own `dangling=true` list filter, the
 * same predicate the prune applies, so there is no client-side copy of the
 * rule to drift.
 */
const PRUNABLE_CONTAINER_STATES = new Set(["stopped", "exited", "created", "configured"]);

const DANGLING_FILTER = { filters: JSON.stringify({ dangling: ["true"] }) };

export function previewContainers(raw: ContainerListItem[]): PrunePreview {
  const prunable = raw.filter(
    (c) => !c.Pod && PRUNABLE_CONTAINER_STATES.has((c.State ?? "").toLowerCase()),
  );
  return {
    containers: {
      count: prunable.length,
      names: prunable.map((c) => c.Names?.[0]?.replace(/^\//, "") || c.Id.slice(0, 12)),
    },
  };
}

function isUntagged(image: ImageListItem): boolean {
  return (image.Names ?? []).length === 0;
}

/**
 * Simulate the image prune's convergence loop.
 *
 * `danglingIds` is the server's own `dangling=true` answer for the first round
 * (it alone knows about manifest-list membership). Later rounds are derived
 * locally: an image becomes prunable once its last child is pruned, if it is
 * untagged, unused and not a manifest list. `ParentId` comes from the same
 * layer tree libimage uses to find children.
 */
export function previewImages(all: ImageListItem[], danglingIds: ReadonlySet<string>): PrunePreview {
  const byId = new Map(all.map((i) => [i.Id, i]));
  const childCount = new Map<string, number>();
  for (const image of all) {
    if (image.ParentId) childCount.set(image.ParentId, (childCount.get(image.ParentId) ?? 0) + 1);
  }

  const unused = (i: ImageListItem) => (i.Containers ?? 0) === 0;
  const removed: ImageListItem[] = [];
  const removedIds = new Set<string>();
  let round = all.filter((i) => danglingIds.has(i.Id) && unused(i));

  while (round.length > 0) {
    const next: ImageListItem[] = [];
    for (const image of round) {
      if (removedIds.has(image.Id)) continue;
      removedIds.add(image.Id);
      removed.push(image);

      const parent = image.ParentId ? byId.get(image.ParentId) : undefined;
      if (!parent) continue;
      const left = (childCount.get(parent.Id) ?? 1) - 1;
      childCount.set(parent.Id, left);
      if (left === 0 && isUntagged(parent) && unused(parent) && !parent.IsManifestList && !removedIds.has(parent.Id)) {
        next.push(parent);
      }
    }
    round = next;
  }

  return {
    images: {
      count: removed.length,
      names: removed.map((i) => i.Id.slice(0, 12)),
    },
  };
}

async function previewImagesFromServer(socketPath: string): Promise<PrunePreview> {
  const [all, dangling] = await Promise.all([
    get<ImageListItem[]>(socketPath, "/images/json", { query: { all: "true" } }),
    get<ImageListItem[]>(socketPath, "/images/json", { query: { all: "true", ...DANGLING_FILTER } }),
  ]);
  return previewImages(all, new Set(dangling.map((i) => i.Id)));
}

async function previewVolumes(socketPath: string): Promise<PrunePreview> {
  const dangling = await get<VolumeListItem[]>(socketPath, "/volumes/json", { query: DANGLING_FILTER });
  return { volumes: { count: dangling.length, names: dangling.map((v) => v.Name) } };
}

async function previewNetworks(socketPath: string): Promise<PrunePreview> {
  const dangling = await get<NetworkListItem[]>(socketPath, "/networks/json", { query: DANGLING_FILTER });
  return { networks: { count: dangling.length, names: dangling.map((n) => n.name) } };
}

/**
 * Stop grace periods.
 *
 * The libpod container endpoints read the grace period from `timeout`, NOT
 * Docker's `t` (pkg/api/handlers/compat/containers_{stop,restart}.go, v5.8.4).
 * Verified live: `stop?t=1` waited the 10s default, `stop?timeout=1` took 1s;
 * and restart ALWAYS uses `timeout`, defaulting to 0 — so `restart?t=10`
 * SIGKILLed the container after ~100ms with no graceful shutdown, while
 * `restart?timeout=10` let its TERM handler run. We therefore always send
 * `timeout`, and when the caller does not choose one we use the container's
 * own configured `Config.StopTimeout`, so `podman run --stop-timeout` and
 * containers.conf are respected.
 *
 * The HTTP deadline must outlast the grace period (a forced remove of a
 * TERM-ignoring container took 10.07s against a 10s client timeout).
 */
const DEFAULT_STOP_TIMEOUT_S = 10;
const GRACE_SLACK_MS = 30_000;

/**
 * Pod actions stop several containers, each with its own grace period, and
 * prunes / forced image removals can stop containers or delete many layers.
 * Their duration is not known up front, so they get a generous fixed bound.
 */
const LONG_ACTION_MS = 300_000;

async function graceSeconds(socketPath: string, id: string, explicit?: number): Promise<number> {
  if (explicit !== undefined) return Math.max(0, Math.trunc(explicit));
  const inspect = await get<ContainerInspect>(socketPath, `/containers/${id}/json`);
  return inspect.Config?.StopTimeout ?? DEFAULT_STOP_TIMEOUT_S;
}

export function graceDeadlineMs(graceSeconds: number): number {
  return graceSeconds * 1000 + GRACE_SLACK_MS;
}

/**
 * Podman answers 304 when an action is a no-op (start a running container,
 * start a running pod, stop a stopped pod — verified live). That is success,
 * but the UI should be able to say nothing changed.
 */
export function actionResult(result: VoidResult): ContainerActionResult {
  return result.changed
    ? { success: true }
    : { success: true, message: "Already in that state; nothing changed" };
}

export function createPodmanEngine(): ContainerEngine {
  return {
    async findSocket(cliSocket?: string) {
      return resolveSocket(cliSocket);
    },

    async ping(socketPath: string) {
      return (await probeSocket(socketPath)) === "podman";
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

    async *streamStats(socketPath: string, id: string, options: { interval?: number; signal?: AbortSignal } = {}) {
      // `interval` (seconds) verified on Podman 5.8.4: interval=1 → one
      // sample per second; omitted → every 5 s.
      const interval = Math.max(1, Math.round(options.interval ?? 1));
      const path = `/containers/stats?containers=${encodeURIComponent(id)}&stream=true&interval=${interval}`;
      for await (const line of streamLines(socketPath, path, { signal: options.signal })) {
        if (line.trim() === "") continue;
        const response = JSON.parse(line) as { Error?: unknown; Stats?: ContainerStats[] | null };
        if (response.Error) {
          throw new Error(typeof response.Error === "string" ? response.Error : JSON.stringify(response.Error));
        }
        const mapped = mapContainerStats(response.Stats ?? [])[0];
        if (mapped) yield mapped;
      }
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
      const { follow = true, tail = 100, timestamps = true, signal } = options;
      const query = `stdout=true&stderr=true&follow=${follow}&tail=${tail}&timestamps=${timestamps}`;

      const decoder = new MultiplexedLogDecoder();

      // Read BYTES, not lines: the multiplexed log format is a binary frame
      // stream, and routing it through a newline-splitting text decoder would
      // corrupt any payload that is not line-oriented.
      for await (const chunk of streamChunks(socketPath, `/containers/${id}/logs?${query}`, { signal })) {
        decoder.append(chunk);
        for (const frame of decoder.decode()) {
          yield frame;
        }
      }
    },

    async startContainer(socketPath: string, id: string) {
      return actionResult(await postVoid(socketPath, `/containers/${id}/start`, {}));
    },

    async stopContainer(socketPath: string, id: string, timeout?: number) {
      const grace = await graceSeconds(socketPath, id, timeout);
      return actionResult(await postVoid(socketPath, `/containers/${id}/stop`, {}, {
        query: { timeout: String(grace) },
        timeout: graceDeadlineMs(grace),
      }));
    },

    async restartContainer(socketPath: string, id: string, timeout?: number) {
      const grace = await graceSeconds(socketPath, id, timeout);
      return actionResult(await postVoid(socketPath, `/containers/${id}/restart`, {}, {
        query: { timeout: String(grace) },
        timeout: graceDeadlineMs(grace),
      }));
    },

    async killContainer(socketPath: string, id: string, signal = "SIGKILL") {
      return actionResult(await postVoid(socketPath, `/containers/${id}/kill`, {}, { query: { signal } }));
    },

    async removeContainer(socketPath: string, id: string, force = false) {
      if (!force) {
        return actionResult(await delVoid(socketPath, `/containers/${id}`, { query: { force: "false" } }));
      }
      // A forced remove stops a running container first, with its grace period.
      const grace = await graceSeconds(socketPath, id);
      return actionResult(await delVoid(socketPath, `/containers/${id}`, {
        query: { force: "true", timeout: String(grace) },
        timeout: graceDeadlineMs(grace),
      }));
    },

    async pruneContainers(socketPath: string, dryRun = false) {
      if (dryRun) {
        return previewContainers(await get<ContainerListItem[]>(socketPath, "/containers/json", {
          query: { all: "true" },
        }));
      }
      return { containers: mapPruneReports(await post<unknown>(socketPath, "/containers/prune", {}, { timeout: LONG_ACTION_MS })) };
    },

    // Pods
    async listPods(socketPath: string) {
      return get<PodListItem[]>(socketPath, "/pods/json");
    },

    async inspectPod(socketPath: string, id: string) {
      return get<PodInspect>(socketPath, `/pods/${id}/json`);
    },

    async startPod(socketPath: string, id: string) {
      return actionResult(await postVoid(socketPath, `/pods/${id}/start`, {}));
    },

    async stopPod(socketPath: string, id: string) {
      return actionResult(await postVoid(socketPath, `/pods/${id}/stop`, {}, { timeout: LONG_ACTION_MS }));
    },

    async restartPod(socketPath: string, id: string) {
      return actionResult(await postVoid(socketPath, `/pods/${id}/restart`, {}, { timeout: LONG_ACTION_MS }));
    },

    async killPod(socketPath: string, id: string) {
      return actionResult(await postVoid(socketPath, `/pods/${id}/kill`, {}, { timeout: LONG_ACTION_MS }));
    },

    async removePod(socketPath: string, id: string, force = false) {
      return actionResult(await delVoid(socketPath, `/pods/${id}`, { query: { force: force.toString() }, timeout: LONG_ACTION_MS }));
    },

    // Images
    async listImages(socketPath: string, all = false) {
      return get<ImageListItem[]>(socketPath, "/images/json", { query: { all: all.toString() } });
    },

    async inspectImage(socketPath: string, id: string) {
      return get<ImageInspect>(socketPath, `/images/${id}/json`);
    },

    async imageHistory(socketPath: string, id: string) {
      return get<ImageHistoryEntry[]>(socketPath, `/images/${id}/history`);
    },

    async removeImage(socketPath: string, id: string, force = false) {
      return actionResult(await delVoid(socketPath, `/images/${id}`, { query: { force: force.toString() }, timeout: LONG_ACTION_MS }));
    },

    async pruneImages(socketPath: string, dryRun = false) {
      if (dryRun) return previewImagesFromServer(socketPath);
      return { images: mapPruneReports(await post<unknown>(socketPath, "/images/prune", {}, { timeout: LONG_ACTION_MS })) };
    },

    // Volumes
    async listVolumes(socketPath: string) {
      return get<VolumeListItem[]>(socketPath, "/volumes/json");
    },

    /**
     * Names of volumes no container references, by the server's own
     * `dangling` filter — the same rule `volume prune` applies. `MountCount`
     * cannot tell "in use": it read 0 even for a volume mounted by a RUNNING
     * container (verified live, Podman 5.8.4).
     */
    async danglingVolumeNames(socketPath: string) {
      const vols = await get<VolumeListItem[]>(socketPath, "/volumes/json", { query: DANGLING_FILTER });
      return vols.map((v) => v.Name);
    },

    /** Containers (stopped ones included) that mount volume `name`. Verified live. */
    async containersUsingVolume(socketPath: string, name: string) {
      return get<ContainerListItem[]>(socketPath, "/containers/json", {
        query: { all: "true", filters: JSON.stringify({ volume: [name] }) },
      });
    },

    async inspectVolume(socketPath: string, name: string) {
      return get<VolumeInspect>(socketPath, `/volumes/${name}/json`);
    },

    async removeVolume(socketPath: string, name: string) {
      return actionResult(await delVoid(socketPath, `/volumes/${name}`));
    },

    async pruneVolumes(socketPath: string, dryRun = false) {
      if (dryRun) return previewVolumes(socketPath);
      return { volumes: mapPruneReports(await post<unknown>(socketPath, "/volumes/prune", {}, { timeout: LONG_ACTION_MS })) };
    },

    // Networks
    async listNetworks(socketPath: string) {
      return get<NetworkListItem[]>(socketPath, "/networks/json");
    },

    async inspectNetwork(socketPath: string, id: string) {
      return get<NetworkInspect>(socketPath, `/networks/${id}/json`);
    },

    async removeNetwork(socketPath: string, id: string) {
      return actionResult(await delVoid(socketPath, `/networks/${id}`));
    },

    async pruneNetworks(socketPath: string, dryRun = false) {
      if (dryRun) return previewNetworks(socketPath);
      return { networks: mapPruneReports(await post<unknown>(socketPath, "/networks/prune", {}, { timeout: LONG_ACTION_MS })) };
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
      // Prefix match, not substring: `includes("/tmp/podtui-dev/")` also matched
      // "/etc/tmp/podtui-dev/podman.sock", so a crafted path could satisfy the
      // destructive-test guard. Found by test/engine.test.ts.
      return (
        socketPath.startsWith("/tmp/podtui-dev/") || socketPath.startsWith("/tmp/podtui-test/")
      );
    },
  };
}