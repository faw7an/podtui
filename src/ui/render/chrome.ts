import { bg, bold, dim, fg, paint, RESET } from "./palette.ts";
import { fit, displayWidth } from "../../util/fit.ts";
import type { Layout } from "../layout/types.ts";
import { PANEL_IDS, type PanelId } from "../layout/types.ts";
import { panelMeta, type FrameModel } from "../view/model.ts";
import type { Theme } from "../../theme/theme.ts";

export interface HeaderOptions {
  theme: Theme;
  color?: boolean;
}

type TabStyle = "full" | "short" | "number";

function tabText(
  id: PanelId,
  visible: boolean,
  focused: boolean,
  style: TabStyle,
): string {
  const { number, title, short } = panelMeta(id);
  const label = style === "full" ? title : style === "short" ? short : "";
  return `${number}${label.length > 0 ? ` ${label}` : ""}`;
}

/**
 * The one-row header (LAYOUT_SPEC §3): brand, tab bar, clock.
 *
 * Degrades in a fixed order so numbers are the last thing to go:
 *   `1 Pods  2 Containers ...` -> `1 Pod 2 Cont ...` -> `1 2 3 4 5 6`
 * and the title then the clock are dropped if even that does not fit.
 * Hidden panels keep their tab, dimmed, so they can be toggled back on.
 */
export function buildHeader(layout: Layout, model: FrameModel, opts: HeaderOptions): string {
  const { theme } = opts;
  const on = opts.color !== false;
  const cols = layout.cols;
  if (cols <= 0) return "";

  const visible = new Set(layout.panels.map((p) => p.id));
  const focusedId = model.focus === "detail" ? null : model.focus;

  const styleFor = (): TabStyle => {
    const full = PANEL_IDS.map((id) => tabText(id, true, false, "full")).join(" ");
    const short = PANEL_IDS.map((id) => tabText(id, true, false, "short")).join(" ");
    const room = cols - 12; // leave room for brand and gaps
    if (displayWidth(full) <= room) return "full";
    if (displayWidth(short) <= room) return "short";
    return "number";
  };

  const style = styleFor();
  const brand = "▲ podtui";
  const brandW = displayWidth(brand) + 2;

  const buildTabs = (markFiltered: boolean): string => {
    let out = "";
    for (const id of PANEL_IDS) {
      const text = tabText(id, visible.has(id), focusedId === id, style);
      // A kept filter marks its tab; the marker is the first thing sacrificed
      // when the header narrows (see below), never the label or number.
      const marked =
        markFiltered && model.panels.find((p) => p.id === id)?.filter ? `${text}⌕` : text;
      const isFocused = focusedId === id;
      const isVisible = visible.has(id);
      // Every tab gets the same one-cell padding so the spacing is uniform
      // whether or not a tab is focused (focus is marked, not re-spaced).
      const body = ` ${marked} `;
      // Explicit background/foreground rather than `inverse()`: the highlight is
      // then the same, predictable colours as the selected row in a list.
      const painted = isFocused
        ? paint(body, [on ? bg(theme.accent) : "", on ? fg(theme.selectionFg) : "", on ? bold() : ""])
        : isVisible
          ? body
          : paint(body, [on ? dim() : ""]);
      out += painted;
    }
    return out;
  };
  let tabs = buildTabs(true);

  // Fit the tab block; if numbers-only still overflows, drop tabs entirely
  // rather than letting a tab wrap (LAYOUT_SPEC §3). The filter marker is the
  // first sacrifice: a marked header that overflows is rebuilt bare in the
  // same style before any label shortening.
  const room = cols - brandW;
  if (displayWidth(tabs) > room) {
    tabs = buildTabs(false);
  }
  if (displayWidth(tabs) > room) {
    tabs = PANEL_IDS.map((id) => ` ${tabText(id, true, false, "number")} `).join("");
    if (displayWidth(tabs) > room) tabs = "";
  }

  const clock = model.clock;
  const withClock = clock.length > 0 && displayWidth(brand) + 2 + displayWidth(tabs) + 2 + displayWidth(clock) <= cols;
  const trailing = withClock ? clock : "";

  const head = `${paint(brand, [on ? fg(theme.accent) : ""])}  ${tabs}`;
  const used = displayWidth(head);
  const gap = Math.max(1, cols - used - displayWidth(trailing) - 1);
  const clockPainted = trailing.length > 0 ? paint(trailing, [on ? dim() : ""]) : "";

  return fit(head + " ".repeat(gap) + clockPainted, cols);
}

/** Which UI state the footer advertises keys for. */
export type FooterHintContext = "base" | "detail" | "filter" | "filterKept" | "logs";

export interface FooterOptions {
  theme: Theme;
  color?: boolean;
  /**
   * Overrides the model-derived context. When unset, `focus === "detail"`
   * (which the reducer sets exactly when fullscreen detail opens) selects the
   * detail hints; anything else selects the list hints.
   */
  context?: FooterHintContext;
}

const HINTS: { key: string; desc: string }[] = [
  { key: "1-6", desc: "panel" },
  { key: "Tab", desc: "focus" },
  { key: "↑↓jk", desc: "move" },
  { key: "Enter", desc: "inspect" },
  { key: "z", desc: "zoom" },
  { key: "?", desc: "help" },
  { key: "q", desc: "quit" },
];

/**
 * Keys that matter once detail is fullscreen. Every key here must exist in
 * KEYMAP (`src/ui/view/help.ts`), which the `?` overlay renders — the R-17
 * no-drift rule applies to every context, not just the base list.
 */
/**
 * Keys that matter while a `/` filter is capturing typing. Deliberately short:
 * the query itself is echoed in the panel title, and `q`/`?` must NOT appear —
 * they type characters in this mode, so advertising them as quit/help would lie.
 */
/** Detail focused on the Logs tab (P3-T2): the arrows scroll the log. */
const LOG_HINTS: { key: string; desc: string }[] = [
  { key: "↑↓jk", desc: "scroll" },
  { key: "/", desc: "search" },
  { key: "n N", desc: "match" },
  { key: "e", desc: "errors" },
  { key: "p", desc: "pause" },
  { key: "g G", desc: "top/live" },
  { key: "[ ]", desc: "tab" },
  { key: "Esc", desc: "back" },
  { key: "?", desc: "help" },
  { key: "q", desc: "quit" },
];

const FILTER_HINTS: { key: string; desc: string }[] = [
  { key: "Esc", desc: "clear" },
  { key: "Enter", desc: "keep" },
];

const DETAIL_HINTS: { key: string; desc: string }[] = [
  { key: "[ ]", desc: "tab" },
  { key: "↑↓jk", desc: "next" },
  { key: "Space", desc: "fold" },
  { key: "Esc", desc: "back" },
  { key: "?", desc: "help" },
  { key: "q", desc: "quit" },
];

/**
 * Hints when a kept (non-typing) filter sits on the focused panel. `Esc` leads
 * because it clears the filter — the priority hint above the rest — and the
 * drop rule then keeps `[Esc, q]` at minimum width. Every key is in KEYMAP.
 */
const FILTER_KEPT_HINTS: { key: string; desc: string }[] = [
  { key: "Esc", desc: "clear filter" },
  { key: "1-6", desc: "panel" },
  { key: "Tab", desc: "focus" },
  { key: "↑↓jk", desc: "move" },
  { key: "Enter", desc: "inspect" },
  { key: "z", desc: "zoom" },
  { key: "?", desc: "help" },
  { key: "q", desc: "quit" },
];

/**
 * The one-row footer. Hints are dropped by ascending priority (help first) when
 * the row is too narrow; `quit` is never dropped.
 */
export function buildFooter(
  layout: Layout,
  model: FrameModel,
  opts: FooterOptions,
): string {
  const { theme } = opts;
  const on = opts.color !== false;
  const cols = layout.cols;
  if (cols <= 0) return "";

  const error = model.error ? `! ${model.error}` : undefined;

  const render = (hints: typeof HINTS): string =>
    hints
      .map((h) => `${paint(h.key, [on ? fg(theme.helpKey) : ""])} ${paint(h.desc, [on ? dim() : ""])}`)
      .join("  ");

  const context: FooterHintContext =
    opts.context ?? (model.focus === "detail" ? (model.detail.log ? "logs" : "detail") : "base");
  let hints =
    context === "logs"
      ? LOG_HINTS
      : context === "detail"
      ? DETAIL_HINTS
      : context === "filter"
        ? FILTER_HINTS
        : context === "filterKept"
          ? FILTER_KEPT_HINTS
          : HINTS;
  while (hints.length > 1 && displayWidth(render(hints)) + displayWidth(error ?? "") > cols - 1) {
    // Drop the least important hint that is not `quit`.
    const dropIndex = hints.length - 2;
    hints = [...hints.slice(0, dropIndex), ...hints.slice(dropIndex + 1)];
  }

  const body = render(hints);
  const errorText = error ? paint(` ${error}`, [on ? fg(theme.error) : ""]) : "";
  const room = cols - displayWidth(body);
  if (displayWidth(errorText) > room) return fit(body, cols);
  const gap = Math.max(0, room - displayWidth(errorText));
  return fit(body + " ".repeat(gap) + errorText, cols);
}

export { RESET };
