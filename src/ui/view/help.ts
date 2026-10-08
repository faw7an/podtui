/**
 * Single source of truth for the app's key bindings (ROADMAP P8-T2: the help
 * overlay must be generated from the same key map the app uses, so the two
 * cannot drift).
 */

export interface KeyBinding {
  key: string;
  desc: string;
  /** Grouping shown in the overlay. */
  section: "panels" | "navigation" | "detail" | "actions" | "app";
}

export const KEYMAP: readonly KeyBinding[] = [
  { key: "1-6", desc: "toggle panel", section: "panels" },
  { key: "Tab", desc: "focus next panel", section: "panels" },
  { key: "↑↓jk", desc: "move selection", section: "navigation" },
  { key: "/", desc: "filter list / search logs", section: "navigation" },
  { key: "Ctrl+U", desc: "clear filter line", section: "navigation" },
  { key: "c", desc: "jump to container", section: "navigation" },
  { key: "Space", desc: "fold sections", section: "detail" },
  { key: "PgUp/PgDn", desc: "scroll detail/logs", section: "detail" },
  { key: "Enter", desc: "open detail", section: "detail" },
  { key: "[ ]", desc: "detail tab", section: "detail" },
  { key: "p", desc: "pause/resume logs", section: "detail" },
  { key: "g G", desc: "logs: oldest / live end", section: "detail" },
  { key: "n N", desc: "logs: next/prev match", section: "detail" },
  { key: "e", desc: "logs: errors only", section: "detail" },
  { key: "t", desc: "logs: timestamps", section: "detail" },
  { key: "w", desc: "logs: wrap lines", section: "detail" },
  { key: "v", desc: "env: reveal secrets", section: "detail" },
  { key: "Esc", desc: "back / close", section: "detail" },
  { key: "z", desc: "zoom panel", section: "panels" },
  { key: "s", desc: "start", section: "actions" },
  { key: "S", desc: "stop", section: "actions" },
  { key: "r", desc: "restart", section: "actions" },
  { key: "K", desc: "kill (asks first)", section: "actions" },
  { key: "d", desc: "remove (asks first)", section: "actions" },
  { key: "x", desc: "bulk: prune, stop, remove", section: "actions" },
  { key: "R", desc: "quadlets: reload systemd", section: "actions" },
  { key: "?", desc: "help", section: "app" },
  { key: "q", desc: "quit", section: "app" },
] as const;

export const HELP_TITLE = "podtui — keys";
export const HELP_CLOSE_HINT = "Esc close · q quit";

/** Key column width: the longest key plus a two-cell gap. */
export const HELP_KEY_W = Math.max(...KEYMAP.map((k) => k.key.length)) + 2;

/**
 * Pre-formatted help rows, grouped by section. Each section starts with a
 * `# Heading` row, which is also where the overlay may start a new column.
 */
export function helpLines(): string[] {
  const sections: { id: KeyBinding["section"]; label: string }[] = [
    { id: "panels", label: "Panels" },
    { id: "navigation", label: "Navigation" },
    { id: "detail", label: "Detail" },
    { id: "actions", label: "Actions" },
    { id: "app", label: "App" },
  ];
  const out: string[] = [];
  for (const section of sections) {
    const entries = KEYMAP.filter((k) => k.section === section.id);
    if (entries.length === 0) continue;
    out.push(`# ${section.label}`);
    for (const entry of entries) {
      out.push(`${entry.key.padEnd(HELP_KEY_W)}${entry.desc}`);
    }
  }
  return out;
}

export function helpTitle(): string {
  return HELP_TITLE;
}