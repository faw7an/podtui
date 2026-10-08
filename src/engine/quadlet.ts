/**
 * Quadlet files (P6-T1, T5). Pure.
 *
 * Podman lists quadlets and maps them to unit names itself (`GET
 * /libpod/quadlets/json`, honouring `ServiceName=`), so nothing here derives
 * unit names. Verified with the generator's dry run on Podman 5.8.4:
 * `foo.container` → `foo.service`, `.kube` → `foo.service`, and `.volume`,
 * `.network`, `.pod`, `.image`, `.build` add a type suffix
 * (`foo-volume.service`). A `.container` runs as `--name systemd-%N`
 * (`%N` = unit name without `.service`) unless `ContainerName=` is set.
 *
 * Locations (`podman-systemd.unit(5)`): rootless `~/.config/containers/systemd/`,
 * rootful `/etc/containers/systemd/` (present on this machine).
 */

export type QuadletType = "container" | "pod" | "volume" | "network" | "kube" | "image" | "build" | "other";

/** Short labels; plain text, so their width is never in doubt. */
export const QUADLET_LABEL: Record<QuadletType, string> = {
  container: "ctr",
  pod: "pod",
  volume: "vol",
  network: "net",
  kube: "kube",
  image: "img",
  build: "build",
  other: "?",
};

export function quadletType(fileName: string): QuadletType {
  const ext = fileName.slice(fileName.lastIndexOf(".") + 1);
  return (["container", "pod", "volume", "network", "kube", "image", "build"] as const).find((t) => t === ext) ?? "other";
}

/** `Key=Value` of `section` in a systemd-style file (last one wins). */
export function iniValue(text: string, section: string, key: string): string | undefined {
  let current = "";
  let found: string | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#") || line.startsWith(";") || line === "") continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec?.[1]) {
      current = sec[1];
      continue;
    }
    const eq = line.indexOf("=");
    if (current === section && eq > 0 && line.slice(0, eq).trim() === key) found = line.slice(eq + 1).trim();
  }
  return found;
}

/** The container a `.container` quadlet runs, or null for other types. */
export function quadletContainerName(fileName: string, unitName: string, fileText: string): string | null {
  if (quadletType(fileName) !== "container") return null;
  return iniValue(fileText, "Container", "ContainerName") ?? `systemd-${unitName.replace(/\.service$/, "")}`;
}

export type IniLineKind = "section" | "key" | "comment" | "plain";

/** Classify one file line for the File tab's colouring. */
export function iniLine(line: string): { kind: IniLineKind; keyEnd?: number } {
  const t = line.trim();
  if (t.startsWith("#") || t.startsWith(";")) return { kind: "comment" };
  if (/^\[.+\]$/.test(t)) return { kind: "section" };
  const eq = line.indexOf("=");
  if (eq > 0 && /^\s*[A-Za-z0-9_.-]+\s*$/.test(line.slice(0, eq))) return { kind: "key", keyEnd: eq };
  return { kind: "plain" };
}
