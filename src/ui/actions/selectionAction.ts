import type { PanelId } from "../layout/types.ts";
import { quadletContainerName } from "../../engine/quadlet.ts";
import type { ResourceData } from "../view/build.ts";
import {
  confirmContent,
  needsConfirm,
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
  quadlets: "quadlet",
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
  if (!kind) return { kind: "refuse", message: "No actions here." };
  if (!itemId) return { kind: "refuse", message: "Nothing selected." };
  if (!supports(kind, verb)) {
    return {
      kind: "refuse",
      message:
        kind === "quadlet"
          ? "Quadlets: s start, S stop, r restart the unit; R reloads systemd."
          : `${kind[0]?.toUpperCase()}${kind.slice(1)}s can only be removed (d).`,
    };
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

  if (kind === "quadlet") {
    const q = data.quadlets.find((x) => x.id === itemId);
    if (!q) return { kind: "refuse", message: "That quadlet is gone; the list will refresh." };
    const action: ResourceAction = { kind: "quadlet", verb, id: q.unit, name: q.name };
    const running = q.active === "active";
    return needsConfirm(action, running)
      ? { kind: "confirm", action, content: confirmContent(action, { running }) }
      : { kind: "run", action };
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

/**
 * What the failure dialog says (phase-4/error-dialog). Podman's own message
 * is always shown; full container IDs in it become names, and the refusals
 * a user meets most often get one line on what to do next. Recorded texts
 * (Podman 5.8.4, `test/fixtures/remove-reports.json`):
 * - volume: "volume X is being used by the following container(s): <id>: volume is being used"
 * - image: "image used by <id>: image is in use by a container: consider … force-removing image"
 * - network: "default network podman cannot be removed"
 */
export function failureContent(
  action: ResourceAction,
  message: string,
  data: ResourceData,
): { title: string; lines: string[] } {
  const nameOf = (id: string): string =>
    data.containers.find((c) => c.Id === id || c.Id.startsWith(id))?.Names?.[0]?.replace(/^\//, "") ?? id.slice(0, 12);
  const ids = [...new Set(message.match(/\b[0-9a-f]{64}\b/g) ?? [])];
  const readable = ids.reduce((m, id) => m.replaceAll(id, nameOf(id)), message);
  const names = ids.map(nameOf);

  const lines = [readable];
  if (action.kind === "volume" && /is being used/.test(message)) {
    lines.push(`Remove ${names.length > 0 ? names.join(", ") : "the containers using it"} first; the volume's Config lists them under "Used by".`);
  } else if (action.kind === "image" && /in use by a container/.test(message)) {
    lines.push(`Used by ${names.length > 0 ? names.join(", ") : "a container"}. podtui never force-removes images: that would remove those containers too.`);
  } else if (action.kind === "network" && /default network/.test(message)) {
    lines.push("Podman's default network always stays.");
  }
  const verb = { start: "start", stop: "stop", restart: "restart", kill: "kill", remove: "remove" }[action.verb];
  return { title: `Could not ${verb} ${action.kind} ${action.name}`, lines };
}

/**
 * Where `c` on a quadlet lands (P6-T5): the container a `.container` quadlet
 * runs — `ContainerName=`, else `systemd-<unit>` (verified with the
 * generator). Quadlet containers run with `--rm`, so a stopped unit has no
 * container; the message says so instead of failing silently.
 */
export function quadletJumpTarget(
  q: { name: string; unit: string },
  fileText: string,
  data: ResourceData,
): { kind: "jump"; id: string; message: string } | { kind: "none"; message: string } {
  const name = quadletContainerName(q.name, q.unit, fileText);
  if (!name) return { kind: "none", message: `${q.name} does not run a container (only .container quadlets do).` };
  const c = data.containers.find((x) => (x.Names ?? []).some((n) => n.replace(/^\//, "") === name));
  if (!c) return { kind: "none", message: `No container ${name} right now: start the unit with s.` };
  return { kind: "jump", id: c.Id, message: `${q.name}: container ${name} (${c.State})` };
}
