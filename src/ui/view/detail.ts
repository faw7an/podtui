import type { ContainerInspect } from "../../api/types.ts";
import type { DetailLogModel, DetailStatsModel } from "./model.ts";

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
  { id: "logs", label: "Logs" },
  { id: "stats", label: "Stats" },
  { id: "env", label: "Env" },
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
  /** Logs tab stream; set by `buildFrameModel`, never by `buildDetail`. */
  log?: DetailLogModel;
  /** Env tab layout: key column width, so values can be painted (P3-T6). */
  env?: { keyWidth: number };
  /** Stats tab; set by `buildFrameModel`, never by `buildDetail`. */
  stats?: DetailStatsModel;
  /** Extra bottom-border text, e.g. `v reveal secrets`. */
  hint?: string;
}

/** Section keys that can be collapsed in the Config tab. */
export const CONFIG_SECTIONS = ["state", "config", "network", "host"] as const;
export type ConfigSection = (typeof CONFIG_SECTIONS)[number];

/**
 * Keys whose values are masked until `v` reveals them (P3-T6). Substring and
 * case-insensitive on purpose: over-masking (`KEYBOARD_LAYOUT`) costs one
 * keypress, under-masking leaks a secret on screen.
 */
export const SECRET_PATTERN = /(TOKEN|SECRET|PASSWORD|PASSWD|KEY|CREDENTIAL)/i;

/** Fixed width, so the mask never tells the secret's length. */
export const MASK = "********";

export function isSecretKey(key: string): boolean {
  return SECRET_PATTERN.test(key);
}

export function maskValue(key: string, value: string): string {
  if (!isSecretKey(key) || value === "") return value;
  return MASK;
}

export interface BuildDetailArgs {
  inspect: ContainerInspect | null;
  activeTab: DetailTabId;
  hasSelection: boolean;
  collapsed?: ReadonlySet<string>;
  revealSecrets?: boolean;
}

/**
 * Fixed-width label column so values line up without a table library.
 * Exported so the renderer paints exactly the key cell and nothing else.
 */
export const LABEL_W = 13;

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

/** Widest key shown in full; longer keys are cut by the renderer's `fit`. */
const ENV_KEY_MAX = 32;

export interface EnvEntry {
  key: string;
  value: string;
  secret: boolean;
}

/** `KEY=value` strings → entries sorted by key. A bare `KEY` has value "". */
export function parseEnv(env: readonly string[]): EnvEntry[] {
  return env
    .map((entry) => {
      const eq = entry.indexOf("=");
      const key = eq >= 0 ? entry.slice(0, eq) : entry;
      const value = eq >= 0 ? entry.slice(eq + 1) : "";
      return { key, value, secret: isSecretKey(key) && value !== "" };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function envView(inspect: ContainerInspect, reveal: boolean): { lines: string[]; keyWidth: number; hint?: string } {
  const entries = parseEnv(inspect.Config?.Env ?? []);
  if (entries.length === 0) return { lines: ["No environment variables."], keyWidth: 0 };
  const keyWidth = Math.min(ENV_KEY_MAX, Math.max(...entries.map((e) => e.key.length))) + 2;
  const lines = entries.map((e) => `${e.key.padEnd(keyWidth)}${reveal ? e.value : maskValue(e.key, e.value)}`);
  const secrets = entries.filter((e) => e.secret).length;
  const hint = secrets === 0 ? undefined : reveal ? "secrets shown · v hide" : `${secrets} masked · v reveal`;
  return { lines, keyWidth, hint };
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
  let env: DetailView["env"];
  let hint: string | undefined;
  switch (meta?.id) {
    case "config":
      lines = configLines(inspect, args.collapsed ?? new Set());
      break;
    case "env": {
      const view = envView(inspect, args.revealSecrets ?? false);
      lines = view.lines;
      env = view.keyWidth > 0 ? { keyWidth: view.keyWidth } : undefined;
      hint = view.hint;
      break;
    }
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
    ...(env ? { env } : {}),
    ...(hint ? { hint } : {}),
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

/**
 * `Space` in the detail pane: fold everything or unfold everything, with one
 * predictable result. Per-section targeting would need a section cursor — a
 * new navigation dimension that belongs to Phase 3 — so the single key flips
 * the whole tab instead. The singular `toggleSection` stays for that future.
 */
export function toggleAllSections(collapsed: ReadonlySet<string>): Set<string> {
  if (CONFIG_SECTIONS.every((s) => collapsed.has(s))) return new Set();
  return new Set(CONFIG_SECTIONS);
}