import type { PanelId } from "../layout/types.ts";
import type { ResourceData } from "../view/build.ts";
import {
  confirmContent,
  supports,
  type ActionVerb,
  type ConfirmContent,
  type ResourceAction,
  type ResourceKind,
} from "./resourceActions.ts";

/**
 * Turn "this key on this selected row" into a concrete action (P4-T5). Pure.
 *
 * The data comes from the latest poll, so `force` and the dialog's member
 * list describe the item as it is now. See resourceActions.ts for why only
 * containers (when running) and pods (when they have members) are forced.
 */

const KIND: Partial<Record<PanelId, ResourceKind>> = {
  containers: "container",
  pods: "pod",
  images: "image",
  volumes: "volume",
  networks: "network",
};

export type ActionRequest =
  | { kind: "run"; action: ResourceAction }
  | { kind: "confirm"; action: ResourceAction; content: ConfirmContent }
  | { kind: "refuse"; message: string };

export function actionFor(
  panel: PanelId,
  itemId: string,
  verb: ActionVerb,
  data: ResourceData,
  displayName: string,
): ActionRequest {
  const kind = KIND[panel];
  if (!kind) return { kind: "refuse", message: "No actions for quadlets yet (phase 6)." };
  if (!itemId) return { kind: "refuse", message: "Nothing selected." };
  if (!supports(kind, verb)) {
    return { kind: "refuse", message: `${kind[0]?.toUpperCase()}${kind.slice(1)}s can only be removed (d).` };
  }

  const base = { kind, verb, id: itemId, name: displayName || itemId.slice(0, 12) };
  const confirm = (action: ResourceAction, ctx: Parameters<typeof confirmContent>[1] = {}): ActionRequest =>
    verb === "remove" || verb === "kill"
      ? { kind: "confirm", action, content: confirmContent(action, ctx) }
      : { kind: "run", action };

  if (kind === "container") {
    const c = data.containers.find((x) => x.Id === itemId);
    if (!c) return { kind: "refuse", message: "That container is gone; the list will refresh." };
    const running = c.State === "running";
    return confirm({ ...base, force: verb === "remove" && running }, { running });
  }

  if (kind === "pod") {
    const p = data.pods.find((x) => x.Id === itemId);
    if (!p) return { kind: "refuse", message: "That pod is gone; the list will refresh." };
    const members = (p.Containers ?? []).map((m) => m.Names);
    const running = (p.Containers ?? []).some((m) => m.Status === "running");
    // `pod rm` refuses a pod with ANY containers unless forced (CLI help).
    return confirm({ ...base, force: verb === "remove" && members.length > 0 }, { running, members });
  }

  return confirm(base);
}

/**
 * Where `c` on a pod lands (P4-T7): its first member that is not the infra
 * container, in the pod list's order. Pure, so the choice is testable.
 */
export function podJumpTarget(
  data: ResourceData,
  podId: string,
): { kind: "jump"; id: string; message: string } | { kind: "none"; message: string } {
  const pod = data.pods.find((p) => p.Id === podId);
  if (!pod) return { kind: "none", message: "Select a pod first." };
  const members = (pod.Containers ?? []).filter((m) => m.Id !== pod.InfraId);
  const first = members[0];
  if (!first) return { kind: "none", message: `${pod.Name} has no containers besides its infra container.` };
  const others = members.length - 1;
  return {
    kind: "jump",
    id: first.Id,
    message: `${pod.Name}: ${first.Names}${others > 0 ? ` (+${others} more in this pod)` : ""}`,
  };
}
