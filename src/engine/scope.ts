import type { ContainerListItem } from "../api/types.ts";

/**
 * What plain `podtui` shows: YOUR containers — the ones you make with
 * `podman run` / `podman create` or `podman compose`, from any folder.
 * Development ENVIRONMENTS made by toolbox and distrobox are system-level
 * and appear only with `podtui --all` (maintainer request, 2026-10-08).
 *
 * Verified on this machine's real Podman (labels read with
 * `podman inspect`): toolbox containers carry
 * `com.github.containers.toolbox=true`; distrobox containers carry
 * `manager=distrobox`; containers from `podman run` and compose carry
 * neither. Fixture: `environment-labels.json` (labels only).
 */

export type Scope = { kind: "all" } | { kind: "mine" };

/** True for a toolbox or distrobox environment container. */
export function isEnvironment(labels: Record<string, string> | null | undefined): boolean {
  if (!labels) return false;
  return labels["com.github.containers.toolbox"] === "true" || labels["manager"] === "distrobox";
}

/** Which tool made it, for messages ("toolbox", "distrobox"). */
export function environmentKind(labels: Record<string, string> | null | undefined): "toolbox" | "distrobox" | null {
  if (labels?.["com.github.containers.toolbox"] === "true") return "toolbox";
  if (labels?.["manager"] === "distrobox") return "distrobox";
  return null;
}

export interface Scoped {
  containers: ContainerListItem[];
  pods: { Id: string; Containers?: { Id: string }[] | null }[];
  images: { Id: string }[];
}

/**
 * Narrow to your containers. Pods are hidden only when every container in
 * them is a hidden environment; images only when the sole containers using
 * them are hidden environments (an unused image, or one your containers use,
 * stays). Volumes and networks are not touched. `all` returns `data`.
 */
export function applyScope<T extends Scoped>(scope: Scope, data: T): T & { hiddenEnvironments: number } {
  if (scope.kind === "all") return { ...data, hiddenEnvironments: 0 };
  const hidden = data.containers.filter((c) => isEnvironment(c.Labels));
  if (hidden.length === 0) return { ...data, hiddenEnvironments: 0 };
  const hiddenIds = new Set(hidden.map((c) => c.Id));
  const containers = data.containers.filter((c) => !hiddenIds.has(c.Id));
  const visibleImages = new Set(containers.map((c) => c.ImageID));
  const hiddenImages = new Set(hidden.map((c) => c.ImageID));
  return {
    ...data,
    containers,
    pods: data.pods.filter((p) => {
      const members = p.Containers ?? [];
      return members.length === 0 || members.some((m) => !hiddenIds.has(m.Id));
    }),
    images: data.images.filter((i) => visibleImages.has(i.Id) || !hiddenImages.has(i.Id)),
    hiddenEnvironments: hidden.length,
  };
}

/** Header label: what the view is limited to. */
export function scopeLabel(scope: Scope): string {
  return scope.kind === "all" ? "all containers" : "your containers";
}

/** Text for an empty container list in the default view. */
export function emptyContainersNote(scope: Scope, hiddenEnvironments: number): string | null {
  if (scope.kind === "all") return null;
  const hidden =
    hiddenEnvironments > 0
      ? ` ${hiddenEnvironments} toolbox/distrobox environment${hiddenEnvironments === 1 ? " is" : "s are"} hidden; podtui --all shows ${hiddenEnvironments === 1 ? "it" : "them"}.`
      : "";
  return `No containers yet. Start one with podman run … or podman compose up -d — it shows up here from any folder.${hidden}`;
}
