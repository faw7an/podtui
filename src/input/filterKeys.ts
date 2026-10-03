import type { Action } from "../ui/layout/layoutReducer.ts";

/**
 * Pure key routing for the `/` filter popup (redesigned filter UX).
 *
 * Called only while a filter is capturing typing (`filterFor !== null`); the
 * App falls through to its normal keys otherwise. Extracted pure so the
 * "global keys are dead inside the popup" contract is unit-testable without
 * mounting anything: `q` and `1` arrive here as text and can never reach the
 * quit/toggle branches, because the App returns before them.
 *
 * Deliberately unhandled (return null, App ignores): Tab, arrows, PgUp/PgDn
 * (no text to append — detail scroll stays inert while typing), and anything
 * with Ctrl/Meta except Ctrl+U. Ctrl+C never reaches this function: the App
 * exits first.
 */
export interface FilterKeyState {
  return?: boolean;
  backspace?: boolean;
  delete?: boolean;
  tab?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
}

export function routeFilterKey(input: string, key: FilterKeyState): Action | null {
  if (key.return) return { type: "endFilter" };
  if (key.backspace || key.delete) return { type: "filterBackspace" };
  if (key.ctrl && input === "u") return { type: "clearFilterLine" };
  if (
    input !== "" &&
    !key.ctrl &&
    !key.meta &&
    !key.tab &&
    !key.upArrow &&
    !key.downArrow &&
    !key.leftArrow &&
    !key.rightArrow &&
    !key.pageUp &&
    !key.pageDown
  ) {
    return { type: "filterInput", text: input };
  }
  return null;
}