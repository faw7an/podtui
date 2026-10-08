import type { Rect } from "../layout/types.ts";
import type { Theme } from "../../theme/theme.ts";
import { displayWidth, fit } from "../../util/fit.ts";
import { formatBytes } from "../../util/format.ts";
import { HIGH_RISK_WORD, type BulkFlow } from "../bulk/bulkFlow.ts";
import type { BulkPreview, BulkResult } from "../bulk/commands.ts";
import { wrapText } from "./confirmDialog.ts";
import { bg, bold, dim, fg, paint, RESET } from "./palette.ts";

/**
 * The `x` menu box (P5-T1/T3/T4/T5). `bulkContent` decides WHAT each stage
 * says (pure, plain text + a few semantic marks, unit-tested); `renderBulk`
 * draws it as an exact-size box like the confirm dialog.
 */

export const PREVIEW_NAMES = 10;
const CURSOR = "▌";

export interface BulkRow {
  text: string;
  /** How to paint the row. */
  style?: "selected" | "danger" | "dim" | "ok" | "error" | "heading";
}

export interface BulkContent {
  title: string;
  rows: BulkRow[];
  hint: string;
  /** Red border for anything destructive. */
  danger: boolean;
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** "a, b, c … and 7 more" over at most PREVIEW_NAMES names. */
export function nameList(names: readonly string[], max = PREVIEW_NAMES): string {
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown} … and ${names.length - max} more` : shown;
}

/** One-line summary, e.g. "Removed 3 containers, reclaimed 120.0MB". */
export function resultSummary(r: BulkResult): string {
  const verb = r.verb[0]?.toUpperCase() + r.verb.slice(1);
  const size = r.reclaimedBytes !== undefined && r.done.length > 0 ? `, reclaimed ${formatBytes(r.reclaimedBytes)}` : "";
  const fails = r.failed.length > 0 ? `; ${r.failed.length} failed` : "";
  return `${verb} ${plural(r.done.length, r.noun)}${size}${fails}`;
}

function previewRows(preview: BulkPreview, verb: string, noun: string): BulkRow[] {
  return [
    { text: `This will ${verb} ${plural(preview.count, noun)}:`, style: "heading" },
    { text: nameList(preview.targets.map((t) => t.name)) },
    { text: "" },
    ...preview.notes.map((n) => ({ text: n, style: "dim" as const })),
  ];
}

export function bulkContent(flow: BulkFlow): BulkContent {
  switch (flow.stage) {
    case "menu":
      return {
        title: "Bulk commands",
        rows: flow.commands.map((c, i) => ({
          text: `${i === flow.cursor ? "▸" : " "} ${i + 1}  ${c.label}${c.risk === "high" ? "  ⚠ high risk" : ""}`,
          style: i === flow.cursor ? "selected" : c.risk === "high" ? "danger" : undefined,
        })),
        hint: " ↑↓ choose · Enter preview · Esc close ",
        danger: false,
      };
    case "previewing":
      return { title: flow.command.label, rows: [{ text: "Checking what this would affect…", style: "dim" }], hint: " Esc cancel ", danger: false };
    case "nothing":
      return {
        title: flow.command.label,
        rows: [{ text: `Nothing to do: no ${flow.command.noun}s match.`, style: "ok" }],
        hint: " Enter/Esc close ",
        danger: false,
      };
    case "confirm": {
      const high = flow.command.risk === "high";
      const rows = previewRows(flow.preview, flow.command.verb, flow.command.noun);
      rows.push({ text: "" });
      if (high) {
        rows.push({ text: `Type ${HIGH_RISK_WORD} and press Enter to confirm:`, style: "danger" });
        rows.push({ text: `> ${flow.typed}${CURSOR}` });
      } else {
        rows.push({ text: `Press y to ${flow.command.verb} ${plural(flow.preview.count, flow.command.noun)}.`, style: "danger" });
      }
      return {
        title: flow.command.label,
        rows,
        hint: high ? " Esc cancel " : " y run · n/Enter/Esc cancel ",
        danger: true,
      };
    }
    case "running":
      return {
        title: flow.command.label,
        rows: [{ text: `Working on ${plural(flow.preview.count, flow.command.noun)}…`, style: "dim" }],
        hint: " please wait ",
        danger: true,
      };
    case "result": {
      const r = flow.result;
      const rows: BulkRow[] = [{ text: resultSummary(r), style: r.failed.length > 0 ? "error" : "ok" }];
      if (r.done.length > 0) rows.push({ text: nameList(r.done) });
      if (r.failed.length > 0) {
        rows.push({ text: "" }, { text: `Failed (${r.failed.length}):`, style: "error" });
        for (const f of r.failed.slice(0, PREVIEW_NAMES)) rows.push({ text: `${f.name}: ${f.error}` });
        if (r.failed.length > PREVIEW_NAMES) rows.push({ text: `… and ${r.failed.length - PREVIEW_NAMES} more` });
      }
      return { title: flow.command.label, rows, hint: " Enter/Esc close ", danger: r.failed.length > 0 };
    }
    case "failed":
      return {
        title: flow.command.label,
        rows: [{ text: "Podman refused:", style: "error" }, { text: flow.message }],
        hint: " Enter/Esc close ",
        danger: true,
      };
  }
}

export const BULK_MAX_W = 72;

/** Wrapped body rows for an inner width. */
function bodyRows(content: BulkContent, iw: number): BulkRow[] {
  // Rows that fit are kept verbatim: wrapping splits on spaces and would eat
  // the alignment padding of unselected menu rows.
  return content.rows.flatMap((r) =>
    displayWidth(r.text) <= Math.max(1, iw - 2) ? [r] : wrapText(r.text, Math.max(1, iw - 2)).map((t) => ({ ...r, text: t })),
  );
}

export function bulkRect(cols: number, rows: number, content: BulkContent): Rect | null {
  const w = Math.min(BULK_MAX_W, cols - 4);
  if (w < 30) return null;
  const h = Math.min(rows - 2, bodyRows(content, w - 2).length + 4);
  if (h < 5) return null;
  return { x: Math.floor((cols - w) / 2), y: Math.max(1, Math.floor((rows - h) / 2)), w, h };
}

export function renderBulk(rect: Rect, content: BulkContent, theme: Theme, on: boolean): string[] {
  const iw = Math.max(0, rect.w - 2);
  const bc = on ? fg(content.danger ? theme.error : theme.accent) : "";
  const R = on ? RESET : "";
  const out: string[] = [];
  const title = fit(` ${content.title} `, Math.max(0, iw - 1));
  out.push(`${bc}╭─${R}${paint(title, on ? [bold()] : [])}${bc}${"─".repeat(Math.max(0, iw - 1 - displayWidth(title)))}╮${R}`);

  const paintRow = (r: BulkRow): string => {
    const text = ` ${r.text}`;
    if (!on) return text;
    switch (r.style) {
      case "selected":
        return paint(fit(text, iw), [bg(theme.accent), fg(theme.selectionFg), bold()]);
      case "danger":
        return paint(text, [fg(theme.error)]);
      case "error":
        return paint(text, [fg(theme.error), bold()]);
      case "ok":
        return paint(text, [fg(theme.ok)]);
      case "dim":
        return paint(text, [dim()]);
      case "heading":
        return paint(text, [bold()]);
      default:
        return text;
    }
  };

  const body = bodyRows(content, iw);
  const room = Math.max(0, rect.h - 4);
  const shown = body.length > room ? [...body.slice(0, Math.max(0, room - 1)), { text: `… ${body.length - room + 1} more lines`, style: "dim" as const }] : body;
  out.push(`${bc}│${R}${" ".repeat(iw)}${bc}│${R}`);
  for (let i = 0; i < room; i++) {
    const r = shown[i];
    out.push(`${bc}│${R}${fit(r ? paintRow(r) : "", iw)}${bc}│${R}`);
  }
  out.push(`${bc}│${R}${" ".repeat(iw)}${bc}│${R}`);
  const hint = content.hint.length <= iw ? content.hint : "";
  out.push(`${bc}└${"─".repeat(Math.max(0, iw - hint.length))}${R}${paint(hint, on ? [dim()] : [])}${bc}┘${R}`);
  return out;
}
