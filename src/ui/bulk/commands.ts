import type { ContainerListItem } from "../../api/types.ts";
import type { ContainerEngine, PrunePreview, PruneResult } from "../../engine/ContainerEngine.ts";
import type { PanelId } from "../layout/types.ts";

/**
 * The `x` bulk commands (P5-T2), as a data table: id, label, risk, the panel
 * it belongs to (for context ordering, P5-T6), a preview and an execute.
 *
 * Two kinds of command:
 * - PRUNES (containers, images, volumes, networks) are selected by the
 *   SERVER when they run. Their previews reproduce the server's rule exactly
 *   (engine/podman.ts; proven by test/prune-contract.test.ts running real
 *   prunes), so the confirm screen names what the prune will take.
 * - LIST commands (stop all, remove all) act on exactly the targets the
 *   preview named, by id — never on whatever exists by the time you confirm.
 *
 * Verified live (Podman 5.8.4) and reflected here: prune reports carry `Size`
 * for containers, images and volumes (a 2 MB volume reported 2000000) and none
 * for networks; a pod's infra container cannot be force-removed on its own
 * (500 "cannot be removed without removing the pod"), so "remove all" leaves
 * infra containers out and says so.
 */

export type Risk = "low" | "high";

export interface BulkTarget {
  id: string;
  name: string;
}

export interface BulkPreview {
  count: number;
  /** Every target, for list commands; names only for prunes. */
  targets: BulkTarget[];
  /** Extra lines shown on the confirm screen. */
  notes: string[];
}

export interface BulkResult {
  /** "removed" / "stopped". */
  verb: string;
  noun: string;
  done: string[];
  failed: { name: string; error: string }[];
  /** Absent when the endpoint does not report sizes (networks, stop). */
  reclaimedBytes?: number;
}

export type BulkEngine = Pick<
  ContainerEngine,
  | "listContainers"
  | "stopContainer"
  | "removeContainer"
  | "pruneContainers"
  | "pruneImages"
  | "pruneVolumes"
  | "pruneNetworks"
>;

export interface BulkCommand {
  id: string;
  label: string;
  risk: Risk;
  /** What happens to each target, for "This will <verb> N <noun>s". */
  verb: "stop" | "remove";
  noun: string;
  /** Shown first when this panel has focus (P5-T6). */
  panel: PanelId;
  preview(engine: BulkEngine, socketPath: string): Promise<BulkPreview>;
  execute(engine: BulkEngine, socketPath: string, preview: BulkPreview): Promise<BulkResult>;
}

const nameOf = (c: ContainerListItem): string => c.Names?.[0]?.replace(/^\//, "") || c.Id.slice(0, 12);

function previewFromPrune(p: PrunePreview, key: keyof PrunePreview, notes: string[]): BulkPreview {
  const part = p[key] ?? { count: 0, names: [] };
  return { count: part.count, targets: part.names.map((n) => ({ id: n, name: n })), notes };
}

function resultFromPrune(r: PruneResult, key: keyof PruneResult, noun: string, sized: boolean): BulkResult {
  const part = r[key] ?? { count: 0, names: [] };
  return {
    verb: "removed",
    noun,
    done: part.names,
    failed: part.failed ?? [],
    ...(sized ? { reclaimedBytes: part.reclaimedBytes ?? 0 } : {}),
  };
}

/** Run one call per target, all of them, collecting failures by name. */
async function eachTarget(
  targets: BulkTarget[],
  run: (t: BulkTarget) => Promise<unknown>,
): Promise<{ done: string[]; failed: { name: string; error: string }[] }> {
  const settled = await Promise.allSettled(targets.map((t) => run(t)));
  const done: string[] = [];
  const failed: { name: string; error: string }[] = [];
  settled.forEach((s, i) => {
    const name = targets[i]?.name ?? "?";
    if (s.status === "fulfilled") done.push(name);
    else failed.push({ name, error: s.reason instanceof Error ? s.reason.message : String(s.reason) });
  });
  return { done, failed };
}

export const BULK_COMMANDS: readonly BulkCommand[] = [
  {
    id: "stop-all",
    verb: "stop",
    noun: "container",
    label: "Stop all running containers",
    risk: "low",
    panel: "containers",
    async preview(engine, socket) {
      const running = (await engine.listContainers(socket, true)).filter((c) => c.State === "running" && !c.IsInfra);
      return {
        count: running.length,
        targets: running.map((c) => ({ id: c.Id, name: nameOf(c) })),
        notes: ["Each gets its own stop grace period, then SIGKILL.", "Pod infra containers are left to their pods."],
      };
    },
    async execute(engine, socket, preview) {
      const r = await eachTarget(preview.targets, (t) => engine.stopContainer(socket, t.id));
      return { verb: "stopped", noun: "container", ...r };
    },
  },
  {
    id: "prune-containers",
    verb: "remove",
    noun: "container",
    label: "Remove stopped containers",
    risk: "low",
    panel: "containers",
    async preview(engine, socket) {
      const [dry, all] = await Promise.all([engine.pruneContainers(socket, true), engine.listContainers(socket, true)]);
      const p = previewFromPrune(dry as PrunePreview, "containers", [
        "Exited, stopped and created containers. Containers in pods are kept (Podman's prune rule).",
      ]);
      // Show each container's state, so it is clear why it is included
      // (a `created` one is pruned too, and `ps --filter status=exited`
      // would not list it).
      const state = new Map(all.map((c) => [nameOf(c), c.State]));
      return { ...p, targets: p.targets.map((t) => ({ ...t, name: state.has(t.name) ? `${t.name} (${state.get(t.name)})` : t.name })) };
    },
    async execute(engine, socket) {
      return resultFromPrune((await engine.pruneContainers(socket, false)) as PruneResult, "containers", "container", true);
    },
  },
  {
    id: "prune-images",
    verb: "remove",
    noun: "image",
    label: "Prune dangling images",
    risk: "low",
    panel: "images",
    async preview(engine, socket) {
      return previewFromPrune((await engine.pruneImages(socket, true)) as PrunePreview, "images", [
        "Untagged images no container uses, including parents that become dangling.",
      ]);
    },
    async execute(engine, socket) {
      return resultFromPrune((await engine.pruneImages(socket, false)) as PruneResult, "images", "image", true);
    },
  },
  {
    id: "prune-volumes",
    verb: "remove",
    noun: "volume",
    label: "Prune unused volumes",
    risk: "low",
    panel: "volumes",
    async preview(engine, socket) {
      return previewFromPrune((await engine.pruneVolumes(socket, true)) as PrunePreview, "volumes", [
        "Every volume no container references, NAMED volumes included. Their data is deleted.",
      ]);
    },
    async execute(engine, socket) {
      return resultFromPrune((await engine.pruneVolumes(socket, false)) as PruneResult, "volumes", "volume", true);
    },
  },
  {
    id: "prune-networks",
    verb: "remove",
    noun: "network",
    label: "Prune unused networks",
    risk: "low",
    panel: "networks",
    async preview(engine, socket) {
      return previewFromPrune((await engine.pruneNetworks(socket, true)) as PrunePreview, "networks", [
        "Networks no container uses. The default network always stays.",
      ]);
    },
    async execute(engine, socket) {
      return resultFromPrune((await engine.pruneNetworks(socket, false)) as PruneResult, "networks", "network", false);
    },
  },
  {
    id: "remove-all",
    verb: "remove",
    noun: "container",
    label: "Remove ALL containers (forced)",
    risk: "high",
    panel: "containers",
    async preview(engine, socket) {
      const all = await engine.listContainers(socket, true);
      const removable = all.filter((c) => !c.IsInfra);
      const infra = all.length - removable.length;
      return {
        count: removable.length,
        targets: removable.map((c) => ({ id: c.Id, name: nameOf(c) })),
        notes: [
          "Running ones are stopped first. Their writable layers are lost.",
          ...(infra > 0 ? [`${infra} pod infra container${infra === 1 ? "" : "s"} kept: Podman removes those only with their pod.`] : []),
        ],
      };
    },
    async execute(engine, socket, preview) {
      const r = await eachTarget(preview.targets, (t) => engine.removeContainer(socket, t.id, true));
      return { verb: "removed", noun: "container", ...r };
    },
  },
];

/** Commands for the focused panel first, then the rest in table order (P5-T6). */
export function orderedCommands(panel: PanelId, commands: readonly BulkCommand[] = BULK_COMMANDS): BulkCommand[] {
  return [...commands.filter((c) => c.panel === panel), ...commands.filter((c) => c.panel !== panel)];
}
