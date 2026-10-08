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
  ImageHistoryEntry,
} from "../api/types.ts";
import type { LogFrame } from "../api/demux.ts";
import type { SocketResult } from "../api/socket.ts";

export interface EngineError extends Error {
  kind: "unreachable" | "notFound" | "conflict" | "unknown";
  statusCode?: number;
}

export interface PrunePreview {
  containers?: { count: number; names: string[] };
  images?: { count: number; names: string[] };
  volumes?: { count: number; names: string[] };
  networks?: { count: number; names: string[] };
}

/** What a prune actually did. `count`/`names` cover successful removals only. */
export interface PruneOutcome {
  count: number;
  names: string[];
  reclaimedBytes?: number;
  /** Entries the server tried to remove and could not (partial failure). */
  failed?: { name: string; error: string }[];
}

export interface PruneResult {
  containers?: PruneOutcome;
  images?: PruneOutcome;
  volumes?: PruneOutcome;
  networks?: PruneOutcome;
}

export interface ContainerActionResult {
  success: boolean;
  message?: string;
}

export interface ContainerEngine {
  // Connection
  findSocket(cliSocket?: string): Promise<SocketResult>;
  ping(socketPath: string): Promise<boolean>;

  // Version & Info
  getVersion(socketPath: string): Promise<VersionInfo>;
  getInfo(socketPath: string): Promise<Info>;

  // Containers
  listContainers(socketPath: string, all?: boolean): Promise<ContainerListItem[]>;
  inspectContainer(socketPath: string, id: string): Promise<ContainerInspect>;
  containerTop(socketPath: string, id: string): Promise<ContainerTop>;
  containerStats(socketPath: string, ids: string[], stream?: boolean): Promise<ContainerStats[] | AsyncGenerator<ContainerStatsUI>>;
  /**
   * Live stats for one container, one sample per `interval` seconds
   * (default 1). Pass `signal` to stop the stream.
   */
  streamStats(socketPath: string, id: string, options?: { interval?: number; signal?: AbortSignal }): AsyncGenerator<ContainerStatsUI>;
  /** Multiplexed log frames. Pass `signal` to stop the stream promptly. */
  containerLogs(socketPath: string, id: string, options?: { follow?: boolean; tail?: number; timestamps?: boolean; signal?: AbortSignal }): AsyncGenerator<LogFrame>;
  startContainer(socketPath: string, id: string): Promise<ContainerActionResult>;
  /**
   * `timeout` is the stop grace period in seconds before SIGKILL. Omit it to
   * use the container's own configured stop timeout (`--stop-timeout`).
   */
  stopContainer(socketPath: string, id: string, timeout?: number): Promise<ContainerActionResult>;
  /** Same grace-period rule as `stopContainer`. */
  restartContainer(socketPath: string, id: string, timeout?: number): Promise<ContainerActionResult>;
  killContainer(socketPath: string, id: string, signal?: string): Promise<ContainerActionResult>;
  removeContainer(socketPath: string, id: string, force?: boolean): Promise<ContainerActionResult>;
  pruneContainers(socketPath: string, dryRun?: boolean): Promise<PrunePreview | PruneResult>;

  // Pods
  listPods(socketPath: string): Promise<PodListItem[]>;
  inspectPod(socketPath: string, id: string): Promise<PodInspect>;
  startPod(socketPath: string, id: string): Promise<ContainerActionResult>;
  stopPod(socketPath: string, id: string): Promise<ContainerActionResult>;
  restartPod(socketPath: string, id: string): Promise<ContainerActionResult>;
  killPod(socketPath: string, id: string): Promise<ContainerActionResult>;
  removePod(socketPath: string, id: string, force?: boolean): Promise<ContainerActionResult>;

  // Images
  listImages(socketPath: string, all?: boolean): Promise<ImageListItem[]>;
  inspectImage(socketPath: string, id: string): Promise<ImageInspect>;
  imageHistory(socketPath: string, id: string): Promise<ImageHistoryEntry[]>;
  removeImage(socketPath: string, id: string, force?: boolean): Promise<ContainerActionResult>;
  pruneImages(socketPath: string, dryRun?: boolean): Promise<PrunePreview | PruneResult>;

  // Volumes
  listVolumes(socketPath: string): Promise<VolumeListItem[]>;
  /** Volumes nothing references (server `dangling` filter; the prune rule). */
  danglingVolumeNames(socketPath: string): Promise<string[]>;
  /** Containers, stopped included, that mount volume `name`. */
  containersUsingVolume(socketPath: string, name: string): Promise<ContainerListItem[]>;
  inspectVolume(socketPath: string, name: string): Promise<VolumeInspect>;
  removeVolume(socketPath: string, name: string): Promise<ContainerActionResult>;
  pruneVolumes(socketPath: string, dryRun?: boolean): Promise<PrunePreview | PruneResult>;

  // Networks
  listNetworks(socketPath: string): Promise<NetworkListItem[]>;
  inspectNetwork(socketPath: string, id: string): Promise<NetworkInspect>;
  removeNetwork(socketPath: string, id: string): Promise<ContainerActionResult>;
  pruneNetworks(socketPath: string, dryRun?: boolean): Promise<PrunePreview | PruneResult>;

  // Events
  streamEvents(socketPath: string, filters?: Record<string, string[]>): AsyncGenerator<unknown>;

  // Destructive guard
  isSandboxSocket(socketPath: string): boolean;
}