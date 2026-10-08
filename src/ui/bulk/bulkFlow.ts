import type { BulkCommand, BulkPreview, BulkResult } from "./commands.ts";

/**
 * The `x` menu as a state machine (P5-T1, T3, T4). Pure: keys in, next stage
 * and an optional effect out. The App performs the effects (`preview`,
 * `execute`) and feeds their results back with `previewed` / `executed`.
 *
 *   menu ──Enter──▶ previewing ──▶ confirm ──y / "delete"+Enter──▶ running ──▶ result
 *                          └──────▶ nothing (count 0)
 *
 * Esc closes from every stage except `running` (the call is already out;
 * the result screen follows). No path reaches `execute` without passing
 * `confirm`, and a HIGH-risk command needs the exact word `delete` typed.
 */

export const HIGH_RISK_WORD = "delete";

export type BulkFlow =
  | { stage: "menu"; commands: BulkCommand[]; cursor: number }
  | { stage: "previewing"; command: BulkCommand }
  | { stage: "nothing"; command: BulkCommand }
  | { stage: "confirm"; command: BulkCommand; preview: BulkPreview; typed: string }
  | { stage: "running"; command: BulkCommand; preview: BulkPreview }
  | { stage: "result"; command: BulkCommand; result: BulkResult }
  | { stage: "failed"; command: BulkCommand; message: string };

export type BulkEffect = { type: "preview"; command: BulkCommand } | { type: "execute"; command: BulkCommand; preview: BulkPreview };

export interface BulkKey {
  return?: boolean;
  escape?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

export interface BulkStep {
  /** null closes the menu. */
  flow: BulkFlow | null;
  effect?: BulkEffect;
}

export function openBulk(commands: BulkCommand[]): BulkFlow {
  return { stage: "menu", commands, cursor: 0 };
}

export function bulkKey(flow: BulkFlow, input: string, key: BulkKey): BulkStep {
  switch (flow.stage) {
    case "menu": {
      if (key.escape || input === "x" || input === "q") return { flow: null };
      const n = flow.commands.length;
      if (key.upArrow || input === "k") return { flow: { ...flow, cursor: (flow.cursor - 1 + n) % n } };
      if (key.downArrow || input === "j") return { flow: { ...flow, cursor: (flow.cursor + 1) % n } };
      // Digits pick a row directly (1-based), then still preview first.
      const digit = Number.parseInt(input, 10);
      const pick = key.return ? flow.cursor : digit >= 1 && digit <= n ? digit - 1 : -1;
      const command = flow.commands[pick];
      if (!command) return { flow };
      return { flow: { stage: "previewing", command }, effect: { type: "preview", command } };
    }
    case "previewing":
      // Nothing has run; Esc just drops the preview when it arrives.
      return key.escape ? { flow: null } : { flow };
    case "nothing":
    case "result":
    case "failed":
      return key.escape || key.return || input === "q" || input === " " ? { flow: null } : { flow };
    case "running":
      return { flow };
    case "confirm": {
      if (key.escape) return { flow: null };
      const go = (): BulkStep => ({
        flow: { stage: "running", command: flow.command, preview: flow.preview },
        effect: { type: "execute", command: flow.command, preview: flow.preview },
      });
      if (flow.command.risk === "low") {
        if (input === "y" || input === "Y") return go();
        if (input === "n" || input === "N" || key.return) return { flow: null };
        return { flow };
      }
      // High risk: the word must be typed exactly, then Enter.
      if (key.return) return flow.typed === HIGH_RISK_WORD ? go() : { flow };
      if (key.backspace || key.delete) return { flow: { ...flow, typed: Array.from(flow.typed).slice(0, -1).join("") } };
      if (key.ctrl && input === "u") return { flow: { ...flow, typed: "" } };
      if (input && !key.ctrl && !key.meta && flow.typed.length < 32) {
        return { flow: { ...flow, typed: flow.typed + input } };
      }
      return { flow };
    }
  }
}

/** The preview arrived (or failed). Ignored if the user moved on. */
export function previewed(flow: BulkFlow | null, command: BulkCommand, outcome: { preview: BulkPreview } | { error: string }): BulkFlow | null {
  if (!flow || flow.stage !== "previewing" || flow.command !== command) return flow;
  if ("error" in outcome) return { stage: "failed", command, message: outcome.error };
  if (outcome.preview.count === 0) return { stage: "nothing", command };
  return { stage: "confirm", command, preview: outcome.preview, typed: "" };
}

/** The execute call settled. */
export function executed(flow: BulkFlow | null, command: BulkCommand, outcome: { result: BulkResult } | { error: string }): BulkFlow | null {
  if (!flow || flow.stage !== "running" || flow.command !== command) return flow;
  if ("error" in outcome) return { stage: "failed", command, message: outcome.error };
  return { stage: "result", command, result: outcome.result };
}
