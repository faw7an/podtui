// Types derived from test/fixtures/ — do not edit manually
// Generated from real Podman API responses (libpod v5.0.0)

export interface ContainerListItem {
  Id: string;
  Names: string[];
  Image: string;
  ImageID: string;
  Command: string[] | null;
  Created: string;
  State: string;
  Status: string;
  Ports: PortMapping[] | null;
  Labels: Record<string, string>;
  Size: { SizeRw: number; SizeRootFs: number } | null;
  NetworkSettings: ContainerNetworkSettings;
  Mounts: MountPoint[];
  IsInfra: boolean;
  Pod: string;
  PodName: string;
  RestartCount: number;
  Pid: number;
  ExitCode: number;
  Exited: boolean;
  ExitedAt: number;
  StartedAt: number;
}

export interface PortMapping {
  IP: string;
  PrivatePort: number;
  PublicPort: number;
  Type: string;
}

export interface MountPoint {
  Type: string;
  Source: string;
  Destination: string;
  Driver: string;
  Mode: string;
  RW: boolean;
  Propagation: string;
}

export interface ContainerNetworkSettings {
  Networks: Record<string, EndpointSettings>;
}

export interface EndpointSettings {
  IPAddress: string;
  Gateway: string;
  GlobalIPv6Address: string;
  GlobalIPv6Gateway: string;
  MacAddress: string;
  DriverOpts: Record<string, string>;
}

export interface ContainerInspect {
  Id: string;
  Created: string;
  Path: string;
  Args: string[];
  State: ContainerState;
  Image: string;
  ImageDigest: string;
  ImageName: string;
  Rootfs: string;
  Pod: string;
  ResolvConfPath: string;
  HostnamePath: string;
  HostsPath: string;
  StaticDir: string;
  OCIConfigPath: string;
  OCIRuntime: string;
  ConmonPidFile: string;
  PidFile: string;
  Name: string;
  RestartCount: number;
  Driver: string;
  MountLabel: string;
  ProcessLabel: string;
  AppArmorProfile: string;
  EffectiveCaps: string[];
  BoundingCaps: string[];
  ExecIDs: string[];
  GraphDriver: GraphDriverData;
  Mounts: MountPoint[];
  Dependencies: string[];
  NetworkSettings: NetworkSettings;
  Namespace: string;
  IsInfra: boolean;
  IsService: boolean;
  KubeExitCodePropagation: string;
  lockNumber: number;
  Config: ContainerConfig;
  HostConfig: HostConfig;
  UseImageHosts: boolean;
  UseImageHostname: boolean;
}

export interface ContainerState {
  OciVersion: string;
  Status: string;
  Running: boolean;
  Paused: boolean;
  Restarting: boolean;
  OOMKilled: boolean;
  Dead: boolean;
  Pid: number;
  ConmonPid: number;
  ExitCode: number;
  Error: string;
  StartedAt: string;
  FinishedAt: string;
  CgroupPath: string;
  CheckpointedAt: string;
  RestoredAt: string;
}

export interface GraphDriverData {
  Name: string;
  Data: {
    LowerDir: string;
    MergedDir: string;
    UpperDir: string;
    WorkDir: string;
  };
}

export interface NetworkSettings {
  EndpointID: string;
  Gateway: string;
  IPAddress: string;
  IPPrefixLen: number;
  IPv6Gateway: string;
  GlobalIPv6Address: string;
  GlobalIPv6PrefixLen: number;
  MacAddress: string;
  Bridge: string;
  SandboxID: string;
  HairpinMode: boolean;
  LinkLocalIPv6Address: string;
  LinkLocalIPv6PrefixLen: number;
  Ports: Record<string, PortBinding[] | null>;
  SandboxKey: string;
}

export interface PortBinding {
  HostIp: string;
  HostPort: string;
}

export interface ContainerConfig {
  Hostname: string;
  Domainname: string;
  User: string;
  AttachStdin: boolean;
  AttachStdout: boolean;
  AttachStderr: boolean;
  Tty: boolean;
  OpenStdin: boolean;
  StdinOnce: boolean;
  Env: string[];
  Cmd: string[];
  Image: string;
  Volumes: Record<string, object> | null;
  WorkingDir: string;
  Entrypoint: string[];
  OnBuild: string[] | null;
  Labels: Record<string, string>;
  Annotations: Record<string, string>;
  StopSignal: string;
  HealthcheckOnFailureAction: string;
  HealthLogDestination: string;
  HealthcheckMaxLogCount: number;
  HealthcheckMaxLogSize: number;
  CreateCommand: string[];
  Umask: string;
  Timeout: number;
  StopTimeout: number;
  Passwd: boolean;
  sdNotifyMode: string;
  ExposedPorts: Record<string, object>;
}

export interface HostConfig {
  Binds: string[];
  CgroupManager: string;
  CgroupMode: string;
  ContainerIDFile: string;
  LogConfig: LogConfig;
  NetworkMode: string;
  PortBindings: Record<string, PortBinding[]>;
  RestartPolicy: RestartPolicy;
  AutoRemove: boolean;
  AutoRemoveImage: boolean;
  Annotations: Record<string, string>;
  VolumeDriver: string;
  VolumesFrom: string[] | null;
  CapAdd: string[] | null;
  CapDrop: string[] | null;
  Dns: string[] | null;
  DnsOptions: string[] | null;
  DnsSearch: string[] | null;
  ExtraHosts: string[] | null;
  HostsFile: string;
  GroupAdd: string[] | null;
  IpcMode: string;
  Cgroup: string;
  Cgroups: string;
  Links: string[] | null;
  OomScoreAdj: number;
  PidMode: string;
  Privileged: boolean;
  PublishAllPorts: boolean;
  ReadonlyRootfs: boolean;
  SecurityOpt: string[] | null;
  Tmpfs: Record<string, string>;
  UTSMode: string;
  UsernsMode: string;
  ShmSize: number;
  Runtime: string;
  ConsoleSize: [number, number];
  Isolation: string;
  CpuShares: number;
  Memory: number;
  NanoCpus: number;
  CgroupParent: string;
  BlkioWeight: number;
  BlkioWeightDevice: object[] | null;
  BlkioDeviceReadBps: object[] | null;
  BlkioDeviceWriteBps: object[] | null;
  BlkioDeviceReadIOps: object[] | null;
  BlkioDeviceWriteIOps: object[] | null;
  CpuPeriod: number;
  CpuQuota: number;
  CpuRealtimePeriod: number;
  CpuRealtimeRuntime: number;
  CpusetCpus: string;
  CpusetMems: string;
  Devices: object[] | null;
  DiskQuota: number;
  KernelMemory: number;
  MemoryReservation: number;
  MemorySwap: number;
  MemorySwappiness: number | null;
  OomKillDisable: boolean;
  PidsLimit: number;
  Ulimits: Ulimit[];
  CpuCount: number;
  CpuPercent: number;
  IOMaximumIOps: number;
  IOMaximumBandwidth: number;
  CgroupConf: object | null;
}

export interface LogConfig {
  Type: string;
  Config: Record<string, string> | null;
  Path: string;
  Tag: string;
  Size: string;
}

export interface RestartPolicy {
  Name: string;
  MaximumRetryCount: number;
}

export interface Ulimit {
  Name: string;
  Soft: number;
  Hard: number;
}

export interface PodListItem {
  Id: string;
  Name: string;
  Status: string;
  Created: string;
  InfraId: string;
  Containers: PodContainer[];
  Labels: Record<string, string>;
  Networks: string[];
  Namespace: string;
  Cgroup: string;
}

export interface PodContainer {
  Id: string;
  Names: string;
  Status: string;
  RestartCount: number;
}

export interface PodInspect {
  Id: string;
  Name: string;
  Status: string;
  Created: string;
  InfraId: string;
  Containers: PodContainer[];
  Labels: Record<string, string>;
  Networks: string[];
  Namespace: string;
  Cgroup: string;
}

export interface ImageListItem {
  Id: string;
  ParentId: string;
  /** null for an untagged image (test/fixtures/images-list-untagged.json). */
  RepoTags: string[] | null;
  RepoDigests: string[];
  Created: number;
  Size: number;
  SharedSize: number;
  VirtualSize: number;
  Labels: Record<string, string> | null;
  Containers: number;
  Arch: string;
  Digest: string;
  History: string[];
  IsManifestList: boolean;
  /** Absent for an untagged image (test/fixtures/images-list-untagged.json). */
  Names?: string[];
  Os: string;
}

export interface ImageInspect {
  Id: string;
  RepoTags: string[];
  RepoDigests: string[];
  Parent: string;
  Comment: string;
  Created: string;
  Container: string;
  ContainerConfig: ContainerConfig;
  DockerVersion: string;
  Author: string;
  Config: ContainerConfig;
  Architecture: string;
  Os: string;
  Size: number;
  VirtualSize: number;
  GraphDriver: GraphDriverData;
  RootFS: { Type: string; Layers: string[] };
  Metadata: { LastTagTime: string };
}

export interface ImageHistoryItem {
  Id: string;
  Created: number;
  CreatedBy: string;
  Tags: string[];
  Size: number;
  Comment: string;
}

export interface VolumeListItem {
  Name: string;
  Driver: string;
  Mountpoint: string;
  CreatedAt: string;
  Labels: Record<string, string>;
  Scope: string;
  Options: Record<string, string>;
  MountCount: number;
  NeedsCopyUp: boolean;
  NeedsChown: boolean;
  LockNumber: number;
}

export interface VolumeInspect {
  Name: string;
  Driver: string;
  Mountpoint: string;
  CreatedAt: string;
  Labels: Record<string, string>;
  Scope: string;
  Options: Record<string, string>;
  MountCount: number;
  NeedsCopyUp: boolean;
  NeedsChown: boolean;
  LockNumber: number;
}

export interface NetworkListItem {
  name: string;
  id: string;
  driver: string;
  network_interface: string;
  created: string;
  subnets: Subnet[];
  ipv6_enabled: boolean;
  internal: boolean;
  dns_enabled: boolean;
  labels: Record<string, string>;
  ipam_options: IpamOptions;
}

export interface Subnet {
  subnet: string;
  gateway: string;
}

export interface IpamOptions {
  driver: string;
}

export interface NetworkInspect {
  name: string;
  id: string;
  created: string;
  driver: string;
  network_interface: string;
  subnets: Subnet[];
  ipv6_enabled: boolean;
  internal: boolean;
  dns_enabled: boolean;
  labels: Record<string, string>;
  ipam_options: IpamOptions;
  containers: Record<string, EndpointSettings>;
}

export interface Ipam {
  Driver: string;
  Options: Record<string, string>;
  Config: IpamConfig[];
}

export interface IpamConfig {
  Subnet: string;
  Gateway: string;
  IPRange: string;
  AuxiliaryAddresses: Record<string, string>;
}

export interface ContainerStats {
  AvgCPU: number;
  ContainerID: string;
  Name: string;
  CPU: number;
  CPUNano: number;
  CPUSystemNano: number;
  SystemNano: number;
  MemUsage: number;
  MemLimit: number;
  MemPerc: number;
  Network: Record<string, NetworkStats>;
  BlockInput: number;
  BlockOutput: number;
  PIDs: number;
  UpTime: number;
  Duration: number;
}

export interface NetworkStats {
  RxBytes: number;
  RxDropped: number;
  RxErrors: number;
  RxPackets: number;
  TxBytes: number;
  TxDropped: number;
  TxErrors: number;
  TxPackets: number;
}

export interface ContainersStatsResponse {
  Error: string | null;
  Stats: ContainerStats[];
}

export interface ContainerTop {
  Titles: string[];
  Processes: string[][];
}

export interface VersionInfo {
  Version: string;
  ApiVersion: string;
  MinAPIVersion: string;
  GitCommit: string;
  GoVersion: string;
  Os: string;
  Arch: string;
  KernelVersion: string;
  BuildTime: string;
  Platform: { Name: string };
  Components: Component[];
}

export interface Component {
  Name: string;
  Version: string;
  Details: Record<string, string>;
}

export interface Info {
  host: {
    arch: string;
    buildahVersion: string;
    cgroupManager: string;
    cgroupVersion: string;
    cgroupControllers: string[];
    /** Not sent by Podman 5.8.4 (present on 6.1.1). */
    cdiSpecDirs?: string[];
    conmon: { package: string; path: string; version: string };
    cpus: number;
    cpuUtilization: { userPercent: number; systemPercent: number; idlePercent: number };
    distribution: { distribution: string; version: string };
    eventLogger: string;
    hostname: string;
    kernel: string;
    logDriver: string;
    memFree: number;
    /** Not sent by Podman 5.8.4 (present on 6.1.1). */
    memAvailable?: number;
    memTotal: number;
    networkBackend: string;
    ociRuntime: { name: string; package: string; path: string; version: string };
    os: string;
    remoteSocket: { path: string; exists: boolean };
    security: { apparmorEnabled: boolean; capabilities: string; rootless: boolean; seccompEnabled: boolean; selinuxEnabled: boolean };
    uptime: string;
  };
  store: {
    containerStore: { number: number; paused: number; running: number; stopped: number };
    graphDriverName: string;
    graphRoot: string;
    graphRootAllocated: number;
    graphRootUsed: number;
    imageStore: { number: number };
    runRoot: string;
    volumePath: string;
  };
  registries: Record<string, unknown>;
  plugins: { volume: string[]; network: string[]; log: string[]; authorization: string[] | null };
  version: { APIVersion: string; Version: string; GoVersion: string; GitCommit: string; BuiltTime: string; Built: number; OsArch: string; Os: string };
}

// UI-facing models (simplified for display)
export interface Container {
  id: string;
  name: string;
  image: string;
  status: ContainerStatus;
  state: "running" | "exited" | "paused" | "created" | "restarting" | "dead";
  ports: string;
  created: Date;
  labels: Record<string, string>;
  pod?: string;
}

export type ContainerStatus = "running" | "exited" | "paused" | "created" | "restarting" | "dead" | "unknown";

export interface Pod {
  id: string;
  name: string;
  status: string;
  containerCount: number;
  infraId: string;
  created: Date;
  labels: Record<string, string>;
}

export interface Image {
  id: string;
  repoTags: string[];
  repoDigests: string[];
  size: number;
  created: Date;
  labels: Record<string, string>;
  containers: number;
  isDangling: boolean;
}

export interface Volume {
  name: string;
  driver: string;
  mountpoint: string;
  created: Date;
  labels: Record<string, string>;
  scope: string;
  mountCount: number;
  inUse: boolean;
}

export interface Network {
  id: string;
  name: string;
  driver: string;
  created: Date;
  subnets: Subnet[];
  ipv6Enabled: boolean;
  internal: boolean;
  dnsEnabled: boolean;
  labels: Record<string, string>;
}

export interface ContainerStatsUI {
  /** Live: CPU % over the last sample interval (`CPU`). */
  cpuPercent: number;
  /** Average CPU % since the container started (`AvgCPU`). */
  avgCpuPercent: number;
  memUsage: number;
  memLimit: number;
  memPercent: number;
  netRx: number;
  netTx: number;
  blockRead: number;
  blockWrite: number;
  pids: number;
}

export interface LogEntry {
  timestamp: Date;
  stream: "stdout" | "stderr";
  message: string;
}