import type { ContainerInspect } from "../../api/types.ts";

/**
 * Detail pane content (ROADMAP P2-T7: a TabBar plus a Config tab rendering
 * formatted inspect JSON, key/value with colours, collapsible sections,
 * scrollable).
 *
 * Pure and fixture-testable: no Ink, no socket. The renderer windows whatever
 * lines come out of here.
 */

export type DetailTabId = "logs" | "stats" | "env" | "config" | "top";

export interface DetailTabMeta {
  id: DetailTabId;
  label: string;
  /** Placeholder shown when the tab has no data source wired yet. */
  phase?: string;
}

export const DETAIL_TABS: readonly DetailTabMeta[] = [
  { id: "logs", label: "Logs", phase: "phase 3" },
  { id: "stats", label: "Stats", phase: "phase 3" },
  { id: "env", label: "Env", phase: "phase 3" },
  { id: "config", label: "Config" },
  { id: "top", label: "Top", phase: "phase 3" },
] as const;

export interface DetailView {
  title: string;
  tabs: string[];
  activeTab: number;
  activeTabId: DetailTabId;
  /** Flat, pre-formatted rows; `#` starts a collapsible section heading. */
  lines: string[];
}

/** Section keys that can be collapsed in the Config tab. */
export const CONFIG_SECTIONS = ["state", "config", "network", "host"] as const;
export type ConfigSection = (typeof CONFIG_SECTIONS)[number];

/** Keys whose values are masked until explicitly revealed (P3-T6). */
const SECRET_PATTERN = /(TOKEN|SECRET|PASSWORD|PASSWD|KEY|CREDENTIAL)/i;

export function maskValue(key: string, value: string): string {
  return SECRET_PATTERN.test(key) ? "*".repeat(Math.min(8, Math.max(3, value.length))) : value;
}

export interface BuildDetailArgs {
  inspect: ContainerInspect | null;
  activeTab: DetailTabId;
  hasSelection: boolean;
  collapsed?: ReadonlySet<string>;
  revealSecrets?: boolean;
}

/** Fixed-width label column so values line up without a table library. */
const LABEL_W = 13;

function row(key: string, value: string): string {
  return `${key.padEnd(LABEL_W)}${value}`;
}

function section(name: string, collapsed: boolean): string {
  return `# ${name}${collapsed ? " (+)" : ""}`;
}

/**
 * Flatten the inspect object into a small, readable set of sections. Only
 * fields verified present in test/fixtures/container-inspect.json are used.
 */
function configLines(inspect: ContainerInspect, collapsed: ReadonlySet<string>): string[] {
  const isCollapsed = (s: string): boolean => collapsed.has(s);
  const out: string[] = [];

  if (!isCollapsed("state")) {
    out.push(section("State", false));
    out.push(row("Name", inspect.Name ?? ""));
    out.push(row("Status", inspect.State?.Status ?? ""));
    out.push(row("Running", String(inspect.State?.Running ?? false)));
    out.push(row("ExitCode", String(inspect.State?.ExitCode ?? 0)));
    out.push(row("StartedAt", inspect.State?.StartedAt ?? ""));
  } else {
    out.push(section("State", true));
  }

  if (!isCollapsed("config")) {
    out.push(section("Config", false));
    out.push(row("Image", inspect.Config?.Image ?? ""));
    out.push(row("Cmd", (inspect.Config?.Cmd ?? []).join(" ")));
    out.push(row("Entrypoint", (inspect.Config?.Entrypoint ?? []).join(" ")));
    out.push(row("WorkingDir", inspect.Config?.WorkingDir ?? ""));
    out.push(row("User", inspect.Config?.User ?? ""));
  } else {
    out.push(section("Config", true));
  }

  if (!isCollapsed("host")) {
    out.push(section("Host", false));
    out.push(row("Id", inspect.Id.slice(0, 12)));
    out.push(row("Pod", inspect.Pod || "(none)"));
    out.push(row("Created", inspect.Created ?? ""));
  } else {
    out.push(section("Host", true));
  }

  // libpod inspect returns a SINGLE endpoint object (verified: the fixture's
  // NetworkSettings has IPAddress/Gateway/Ports at the top level, no `Networks`
  // map), so there is nothing to enumerate here.
  if (!isCollapsed("network")) {
    out.push(section("Network", false));
    const ns = inspect.NetworkSettings;
    const ports = Object.entries(ns?.Ports ?? {})
      .map(([port, bind]) => {
        const b = Array.isArray(bind) ? bind[0] : bind;
        return b?.HostPort ? `${port} -> ${b.HostIp ?? "0.0.0.0"}:${b.HostPort}` : port;
      })
      .join(", ");
    out.push(row("IPAddress", ns?.IPAddress || "(none)"));
    out.push(row("Gateway", ns?.Gateway || "(none)"));
    out.push(row("Ports", ports || "(none)"));
  } else {
    out.push(section("Network", true));
  }

  return out;
}

function envLines(inspect: ContainerInspect, reveal: boolean): string[] {
  const env = inspect.Config?.Env ?? [];
  if (env.length === 0) return [row("Env", "(empty)")];
  return env.map((entry) => {
    const eq = entry.indexOf("=");
    const key = eq >= 0 ? entry.slice(0, eq) : entry;
    const value = eq >= 0 ? entry.slice(eq + 1) : "";
    return row(key, reveal ? value : maskValue(key, value));
  });
}

function placeholderLine(meta: DetailTabMeta): string {
  return `${meta.label}: not implemented yet (${meta.phase ?? "later"})`;
}

/** Build the detail view for the selected item and active tab. */
export function buildDetail(args: BuildDetailArgs): DetailView {
  const meta = DETAIL_TABS.find((t) => t.id === args.activeTab) ?? DETAIL_TABS[0];
  const activeTab = DETAIL_TABS.findIndex((t) => t.id === meta?.id);

  if (!args.hasSelection || !args.inspect) {
    return {
      title: "(no selection)",
      tabs: DETAIL_TABS.map((t) => t.label),
      activeTab: activeTab < 0 ? 0 : activeTab,
      activeTabId: meta?.id ?? "config",
      lines: ["no selection"],
    };
  }

  const inspect = args.inspect;
  const title = `${inspect.Name || inspect.Id.slice(0, 12)} · ${inspect.State?.Status ?? "unknown"}`;

  let lines: string[];
  switch (meta?.id) {
    case "config":
      lines = configLines(inspect, args.collapsed ?? new Set());
      break;
    case "env":
      lines = envLines(inspect, args.revealSecrets ?? false);
      break;
    default:
      // Logs/Stats/Top have no data source until Phase 3; say so rather than
      // rendering an empty pane that looks broken.
      lines = [placeholderLine(meta as DetailTabMeta)];
      break;
  }

  return {
    title,
    tabs: DETAIL_TABS.map((t) => t.label),
    activeTab: activeTab < 0 ? 0 : activeTab,
    activeTabId: meta?.id ?? "config",
    lines,
  };
}

/** Next/previous tab index, wrapping forward and clamping out-of-range input. */
export function nextTabIndex(current: number, delta: number, count = DETAIL_TABS.length): number {
  if (count <= 0) return 0;
  const wrapped = (((current + delta) % count) + count) % count;
  return Math.min(count - 1, Math.max(0, wrapped));
}

/** Toggle a section in the collapsed set (used by the Config tab). */
export function toggleSection(collapsed: ReadonlySet<string>, section: string): Set<string> {
  const next = new Set(collapsed);
  if (next.has(section)) next.delete(section);
  else next.add(section);
  return next;
}