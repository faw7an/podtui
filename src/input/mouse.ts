import { writeSync } from "node:fs";

/**
 * Mouse input (P7-T6). Pure parsing plus the enable/disable sequences.
 *
 * Verified against xterm's ctlseqs (invisible-island.net, "Mouse Tracking"):
 * - DECSET 1000 "Send Mouse X & Y on button press and release"; 1006
 *   "Enable SGR Mouse Mode". Only these two are enabled: clicks and the
 *   wheel need nothing more, and skipping motion modes (1002/1003) avoids a
 *   flood of events.
 * - SGR report: `CSI < Cb ; Px ; Py` then `M` (press) or `m` (release);
 *   the button is identified on release too.
 * - Cb low two bits: 0 = left, 1 = middle, 2 = right; modifiers add
 *   4 = Shift, 8 = Meta, 16 = Control; motion adds 32; wheel buttons 4/5
 *   are 64/65 and have no release.
 * - "The upper left character position on the terminal is denoted as 1,1."
 *
 * Ink 7.1.1 hands each report to `useInput` as one string with the ESC
 * stripped, e.g. `"[<0;10;5M"` (verified in-session), so the App recognises
 * them at the top of its input handler, before any typing mode sees them.
 */

export const MOUSE_ON = "\u001B[?1000h\u001B[?1006h";
export const MOUSE_OFF = "\u001B[?1006l\u001B[?1000l";

export type MouseButton = "left" | "middle" | "right";

export type MouseEvent =
  | { kind: "press" | "release" | "motion"; button: MouseButton | null; x: number; y: number; shift: boolean; meta: boolean; ctrl: boolean }
  | { kind: "wheel"; direction: "up" | "down"; x: number; y: number; shift: boolean; meta: boolean; ctrl: boolean };

// Built from a char code: the source then contains no raw control character
// (as palette.ts does), which `no-control-regex` rightly rejects.
const ESC = String.fromCharCode(27);
const SGR = new RegExp(`^${ESC}?\\[<(\\d+);(\\d+);(\\d+)([Mm])$`);
const MOUSE_PREFIX = new RegExp(`^${ESC}?\\[<`);

/** True for anything shaped like an SGR mouse report (even malformed). */
export function looksLikeMouse(input: string): boolean {
  return MOUSE_PREFIX.test(input);
}

/**
 * Parse one SGR report. Coordinates come back 0-based (frame cells);
 * anything else returns null.
 */
export function parseMouse(input: string): MouseEvent | null {
  const m = SGR.exec(input);
  if (!m) return null;
  const cb = Number(m[1]);
  const x = Number(m[2]) - 1;
  const y = Number(m[3]) - 1;
  if (x < 0 || y < 0) return null;
  const mods = { shift: (cb & 4) !== 0, meta: (cb & 8) !== 0, ctrl: (cb & 16) !== 0 };
  if (cb & 64) {
    const low = cb & 3;
    if (low > 1) return null; // buttons 6/7 (horizontal wheel): not used
    return { kind: "wheel", direction: low === 0 ? "up" : "down", x, y, ...mods };
  }
  const low = cb & 3;
  const button: MouseButton | null = low === 0 ? "left" : low === 1 ? "middle" : low === 2 ? "right" : null;
  const kind = m[4] === "m" ? "release" : cb & 32 ? "motion" : "press";
  return { kind, button, x, y, ...mods };
}

/**
 * Turn reporting on and make sure it is turned off on every way out: a
 * normal exit, `process.exit`, a signal Ink handles, or a crash. The disable
 * sequence is written synchronously to the terminal fd, because an `exit`
 * handler cannot wait for an async stream write. Returns `disable`, which is
 * idempotent.
 */
export function enableMouse(out: { write(s: string): unknown; fd?: number } = process.stdout): () => void {
  out.write(MOUSE_ON);
  let done = false;
  // A signal does not fire `exit`: Ink restores the screen in its own signal
  // handler and then re-raises the signal (found live: SIGTERM left mouse
  // reporting on, so the shell printed garbage on every click). Handling the
  // signal here turns reporting off and exits with the conventional status;
  // that `process.exit` still runs Ink's exit-time restore.
  const signals: [NodeJS.Signals, number][] = [
    ["SIGTERM", 15],
    ["SIGHUP", 1],
    ["SIGINT", 2],
  ];
  const onSignal = new Map<NodeJS.Signals, () => void>();
  const disable = (): void => {
    if (done) return;
    done = true;
    try {
      if (typeof out.fd === "number") writeSync(out.fd, MOUSE_OFF);
      else out.write(MOUSE_OFF);
    } catch {
      // the terminal is gone; nothing left to restore
    }
    process.off("exit", disable);
    for (const [sig, handler] of onSignal) process.off(sig, handler);
  };
  for (const [sig, num] of signals) {
    const handler = (): void => {
      disable();
      process.exit(128 + num);
    };
    onSignal.set(sig, handler);
    process.on(sig, handler);
  }
  process.on("exit", disable);
  return disable;
}
