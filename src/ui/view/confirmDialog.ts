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
  kind: "confirm";
  action: ResourceAction;
  content: ConfirmContent;
  focus: "cancel" | "confirm";
}

/**
 * A message box with one OK button: an action failed (phase-4/error-dialog).
 * Enter, Esc, Space, y or n close it; nothing else gets through.
 */
export interface MessageDialogState {
  kind: "message";
  content: ConfirmContent;
}

export type DialogState = ConfirmDialogState | MessageDialogState;

export function openConfirm(action: ResourceAction, content: ConfirmContent): ConfirmDialogState {
  return { kind: "confirm", action, content, focus: "cancel" };
}

export function openMessage(title: string, lines: string[]): MessageDialogState {
  return { kind: "message", content: { title, lines, confirmLabel: "OK" } };
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

export function dialogKey(state: DialogState, input: string, key: DialogKey): DialogOutcome {
  if (state.kind === "message") {
    const close = key.escape || key.return || [" ", "y", "Y", "n", "N", "q"].includes(input);
    return close ? { type: "cancel" } : { type: "ignore" };
  }
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
