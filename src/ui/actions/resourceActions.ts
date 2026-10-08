import type { ContainerActionResult, ContainerEngine } from "../../engine/ContainerEngine.ts";

/**
 * Per-item actions (P4-T1..T5). An action is a plain descriptor; `runAction`
 * is the single place that turns one into an engine call, so tests can prove
 * "each action calls the right engine method with the right ID" with a fake
 * engine, and the UI never calls the engine directly.
 *
 * Confirmation policy (FR-6, AGENTS §3): every REMOVE and every KILL asks
 * first. Start/stop/restart are reversible and run at once.
 *
 * Force policy, chosen so a confirmation never removes more than it names
 * (CLI help, Podman 5.8.4):
 * - container: `force` only when it is running ("Force removal of a running
 *   or unusable container"); the dialog says it will be stopped first.
 * - pod: `force` whenever it has containers — "A pod with containers will
 *   not be removed without --force" — and the dialog lists every member,
 *   since they are all stopped and removed with it.
 * - image, volume, network: NEVER forced. `network rm -f` removes "any
 *   containers using network"; `volume rm -f` removes a volume "even if it is
 *   being used by a container"; `rmi -f` is "Force Removal of the image".
 *   The dialog could not name what that takes with it, so Podman's refusal
 *   is shown instead.
 */

export type ResourceKind = "container" | "pod" | "image" | "volume" | "network";
export type ActionVerb = "start" | "stop" | "restart" | "kill" | "remove";

export interface ResourceAction {
  kind: ResourceKind;
  verb: ActionVerb;
  /** Engine id: container/pod/image/network id, or the volume NAME. */
  id: string;
  /** Display name, used in the dialog and the status line. */
  name: string;
  force?: boolean;
}

/** Which verbs each kind supports. */
export const VERBS: Record<ResourceKind, readonly ActionVerb[]> = {
  container: ["start", "stop", "restart", "kill", "remove"],
  pod: ["start", "stop", "restart", "kill", "remove"],
  image: ["remove"],
  volume: ["remove"],
  network: ["remove"],
};

export function supports(kind: ResourceKind, verb: ActionVerb): boolean {
  return VERBS[kind].includes(verb);
}

export function needsConfirm(action: ResourceAction): boolean {
  return action.verb === "remove" || action.verb === "kill";
}

const PROGRESSIVE: Record<ActionVerb, string> = {
  start: "starting",
  stop: "stopping",
  restart: "restarting",
  kill: "killing",
  remove: "removing",
};

const PAST: Record<ActionVerb, string> = {
  start: "started",
  stop: "stopped",
  restart: "restarted",
  kill: "killed",
  remove: "removed",
};

export const busyText = (a: ResourceAction): string => `${PROGRESSIVE[a.verb]} ${a.kind} ${a.name}…`;
export const doneText = (a: ResourceAction): string => `${a.kind} ${a.name} ${PAST[a.verb]}`;

export function runAction(
  engine: Pick<
    ContainerEngine,
    | "startContainer"
    | "stopContainer"
    | "restartContainer"
    | "killContainer"
    | "removeContainer"
    | "startPod"
    | "stopPod"
    | "restartPod"
    | "killPod"
    | "removePod"
    | "removeImage"
    | "removeVolume"
    | "removeNetwork"
  >,
  socketPath: string,
  a: ResourceAction,
): Promise<ContainerActionResult> {
  switch (a.kind) {
    case "container":
      switch (a.verb) {
        case "start":
          return engine.startContainer(socketPath, a.id);
        case "stop":
          return engine.stopContainer(socketPath, a.id);
        case "restart":
          return engine.restartContainer(socketPath, a.id);
        case "kill":
          return engine.killContainer(socketPath, a.id);
        case "remove":
          return engine.removeContainer(socketPath, a.id, a.force === true);
      }
      break;
    case "pod":
      switch (a.verb) {
        case "start":
          return engine.startPod(socketPath, a.id);
        case "stop":
          return engine.stopPod(socketPath, a.id);
        case "restart":
          return engine.restartPod(socketPath, a.id);
        case "kill":
          return engine.killPod(socketPath, a.id);
        case "remove":
          return engine.removePod(socketPath, a.id, a.force === true);
      }
      break;
    case "image":
      if (a.verb === "remove") return engine.removeImage(socketPath, a.id, false);
      break;
    case "volume":
      if (a.verb === "remove") return engine.removeVolume(socketPath, a.id);
      break;
    case "network":
      if (a.verb === "remove") return engine.removeNetwork(socketPath, a.id);
      break;
  }
  return Promise.reject(new Error(`${a.kind} does not support ${a.verb}`));
}

/** What the confirm dialog shows. Every target is named (AGENTS §3). */
export interface ConfirmContent {
  title: string;
  /** Lines naming exactly what is affected. */
  lines: string[];
  confirmLabel: string;
}

export interface ConfirmContext {
  /** The target is running (container) / has running members (pod). */
  running?: boolean;
  /** Pod remove: the member containers that go with it. */
  members?: string[];
}

export function confirmContent(a: ResourceAction, ctx: ConfirmContext = {}): ConfirmContent {
  const what = `${a.kind} ${a.name}`;
  if (a.verb === "kill") {
    return {
      title: `Kill ${a.kind}?`,
      lines: [`Send SIGKILL to ${what}.`, "Processes get no chance to shut down cleanly."],
      confirmLabel: "Kill",
    };
  }
  const lines = [`Remove ${what}.`];
  if (a.kind === "container" && ctx.running) lines.push("It is running: it will be stopped first.");
  if (a.kind === "pod") {
    const members = ctx.members ?? [];
    lines.push(
      members.length === 0
        ? "It has no containers."
        : `Also removes its ${members.length} container${members.length === 1 ? "" : "s"}: ${members.join(", ")}.`,
    );
    if (ctx.running) lines.push("Running containers will be stopped first.");
  }
  if (a.kind === "image") lines.push("Podman refuses if a container uses it; nothing else is removed.");
  if (a.kind === "volume") lines.push("Its data is deleted. Podman refuses if a container uses it.");
  if (a.kind === "network") lines.push("Podman refuses if a container is connected to it.");
  lines.push("This cannot be undone.");
  return { title: `Remove ${a.kind}?`, lines, confirmLabel: "Remove" };
}
