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
import type { LogFrame } from "../api/demux.ts";

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

export interface PruneResult {
  containers?: { count: number; names: string[]; reclaimedBytes?: number };
  images?: { count: number; names: string[]; reclaimedBytes?: number };
  volumes?: { count: number; names: string[]; reclaimedBytes?: number };
  networks?: { count: number; names: string[]; reclaimedBytes?: number };
}

export interface ContainerActionResult {
  success: boolean;
  message?: string;
}

export interface ContainerEngine {
  // Connection
  findSocket(cliSocket?: string): Promise<{ kind: "found"; path: string } | { kind: "unreachable"; message: string; fixCommand: string }>;
  ping(socketPath: string): Promise<boolean>;

  // Version & Info
  getVersion(socketPath: string): Promise<VersionInfo>;
  getInfo(socketPath: string): Promise<Info>;

  // Containers
  listContainers(socketPath: string, all?: boolean): Promise<ContainerListItem[]>;
  inspectContainer(socketPath: string, id: string): Promise<ContainerInspect>;
  containerTop(socketPath: string, id: string): Promise<ContainerTop>;
  containerStats(socketPath: string, ids: string[], stream?: boolean): Promise<ContainerStats[] | AsyncGenerator<ContainerStatsUI>>;
  containerLogs(socketPath: string, id: string, options?: { follow?: boolean; tail?: number; timestamps?: boolean }): AsyncGenerator<LogFrame>;
  startContainer(socketPath: string, id: string): Promise<ContainerActionResult>;
  stopContainer(socketPath: string, id: string, timeout?: number): Promise<ContainerActionResult>;
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
  imageHistory(socketPath: string, id: string): Promise<unknown[]>;
  removeImage(socketPath: string, id: string, force?: boolean): Promise<ContainerActionResult>;
  pruneImages(socketPath: string, dryRun?: boolean): Promise<PrunePreview | PruneResult>;

  // Volumes
  listVolumes(socketPath: string): Promise<VolumeListItem[]>;
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