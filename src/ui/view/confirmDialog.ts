import type { ConfirmContent, ResourceAction } from "../actions/resourceActions.ts";

/**
 * Confirm dialog state and keys (P4-T6, FR-6). Pure.
 *
 * Focus starts on CANCEL, so a reflexive Enter never destroys anything.
 * `y` confirms, `n`/Esc cancel, Enter activates the focused button,
 * Tab / ←→ / h l move focus. Every other key is swallowed: while the dialog
 * is open nothing behind it reacts.
 */

export interface ConfirmDialogState {
  action: ResourceAction;
  content: ConfirmContent;
  focus: "cancel" | "confirm";
}

export function openConfirm(action: ResourceAction, content: ConfirmContent): ConfirmDialogState {
  return { action, content, focus: "cancel" };
}

export interface DialogKey {
  return?: boolean;
  escape?: boolean;
  tab?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
}

export type DialogOutcome =
  | { type: "confirm"; action: ResourceAction }
  | { type: "cancel" }
  | { type: "focus"; state: ConfirmDialogState }
  | { type: "ignore" };

export function dialogKey(state: ConfirmDialogState, input: string, key: DialogKey): DialogOutcome {
  if (key.escape || input === "n" || input === "N") return { type: "cancel" };
  if (input === "y" || input === "Y") return { type: "confirm", action: state.action };
  if (key.return) {
    return state.focus === "confirm" ? { type: "confirm", action: state.action } : { type: "cancel" };
  }
  if (key.tab || key.leftArrow || key.rightArrow || input === "h" || input === "l") {
    return { type: "focus", state: { ...state, focus: state.focus === "cancel" ? "confirm" : "cancel" } };
  }
  return { type: "ignore" };
}
