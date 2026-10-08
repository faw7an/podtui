import type { ContainerListItem } from "../api/types.ts";

/**
 * Project scope: plain `podtui` shows the compose project of the current
 * folder; `podtui --all` shows everything (maintainer request, 2026-10-08).
 *
 * Verified on Podman 5.8.4 with podman-compose 1.6.0 and Docker Compose
 * v5.5.0 (fixture `compose-projects.json`): both label every CONTAINER with
 *   com.docker.compose.project              the project name (honours -p and `name:`)
 *   com.docker.compose.project.working_dir  the absolute folder it was started from
 * and every VOLUME and NETWORK with `com.docker.compose.project`.
 * podman-compose also puts containers in a pod `pod_<project>` that carries
 * NO labels, so pods are matched through the containers they hold.
 *
 * Matching by working_dir means no compose file has to be read or parsed:
 * the containers say where they came from and what project they belong to.
 */

export const LABEL_PROJECT = "com.docker.compose.project";
export const LABEL_WORKING_DIR = "com.docker.compose.project.working_dir";

/**
 * File names compose tools look for, from podman-compose 1.6.0's own
 * `COMPOSE_DEFAULT_LS` (which includes Docker Compose's names). Used only to
 * tell "a project that is not started" from "no project here".
 */
export const COMPOSE_FILES = [
  "compose.yaml",
  "compose.yml",
  "podman-compose.yaml",
  "podman-compose.yml",
  "docker-compose.yml",
  "docker-compose.yaml",
  "container-compose.yml",
  "container-compose.yaml",
] as const;

export type Scope =
  | { kind: "all" }
  /** `projects` may be empty: nothing from this folder is running yet. */
  | { kind: "project"; dir: string; projects: string[]; composeFile: string | null };

const trimSlash = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** `dir` is `base` or inside it. */
export function isWithin(dir: string, base: string): boolean {
  const d = trimSlash(dir);
  const b = trimSlash(base);
  return d === b || d.startsWith(b === "/" ? "/" : `${b}/`);
}

/**
 * The project(s) of `cwd`: containers whose working_dir is `cwd` or a folder
 * containing it (so podtui works from a project's subfolder). The NEAREST
 * such folder wins, so a project nested inside another one is not mixed in.
 */
export function projectScope(cwd: string, containers: readonly ContainerListItem[], composeFile: string | null): Scope {
  const candidates = containers
    .map((c) => ({ dir: c.Labels?.[LABEL_WORKING_DIR], project: c.Labels?.[LABEL_PROJECT] }))
    .filter((x): x is { dir: string; project: string } => !!x.dir && !!x.project && isWithin(cwd, x.dir));
  if (candidates.length === 0) return { kind: "project", dir: trimSlash(cwd), projects: [], composeFile };
  const nearest = candidates.reduce((a, b) => (trimSlash(b.dir).length > trimSlash(a.dir).length ? b : a)).dir;
  const projects = [...new Set(candidates.filter((x) => trimSlash(x.dir) === trimSlash(nearest)).map((x) => x.project))].sort();
  return { kind: "project", dir: trimSlash(nearest), projects, composeFile };
}

export interface Scoped {
  containers: ContainerListItem[];
  pods: { Id: string; Containers?: { Id: string }[] | null }[];
  images: { Id: string }[];
  volumes: { Name: string; Labels?: Record<string, string> | null }[];
  networks: { name: string; labels?: Record<string, string> | null }[];
}

/**
 * Narrow every resource to the scope: containers of the project(s); pods
 * holding any of them; images any of them use; volumes and networks carrying
 * the project label. In `all` scope everything passes unchanged.
 */
export function applyScope<T extends Scoped>(scope: Scope, data: T): T {
  if (scope.kind === "all") return data;
  const projects = new Set(scope.projects);
  const containers = data.containers.filter((c) => projects.has(c.Labels?.[LABEL_PROJECT] ?? ""));
  const ids = new Set(containers.map((c) => c.Id));
  const imageIds = new Set(containers.map((c) => c.ImageID));
  return {
    ...data,
    containers,
    pods: data.pods.filter((p) => (p.Containers ?? []).some((m) => ids.has(m.Id))),
    images: data.images.filter((i) => imageIds.has(i.Id)),
    volumes: data.volumes.filter((v) => projects.has(v.Labels?.[LABEL_PROJECT] ?? "")),
    networks: data.networks.filter((n) => projects.has(n.labels?.[LABEL_PROJECT] ?? "")),
  };
}

/** One line for the header: what this view is limited to. */
export function scopeLabel(scope: Scope): string {
  if (scope.kind === "all") return "all containers";
  if (scope.projects.length === 0) return "no project here";
  return `project: ${scope.projects.join(", ")}`;
}

/** Why a scoped panel is empty: what to do next. */
export function scopeEmptyNote(scope: Scope): string | null {
  if (scope.kind === "all") return null;
  if (scope.projects.length > 0) return null;
  return scope.composeFile
    ? `${scope.composeFile} is here but nothing from it has run yet: start it with podman compose up -d. Run podtui --all to see every container.`
    : `No compose project in ${scope.dir}. podtui shows the project of the folder you start it in; run podtui --all to see every container on this machine.`;
}
