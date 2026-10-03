/**
 * P0-T8 environment report: produce the evidence for the entries in
 * docs/DECISIONS.md that are still marked "not yet tested" — the terminal
 * emulator in use, truecolor support, and SGR mouse reporting.
 *
 * Run it in the terminal you actually use podtui in:
 *
 *   bun run scripts/env-report.ts
 *
 * It prints what it can measure, then asks you to look at the gradient and move
 * the mouse. Nothing here is asserted on your behalf: the report records what
 * the environment says and what the mouse sequence looked like, and a human
 * confirms whether the gradient *looked* right.
 *
 * The mouse section is the only part that mutates terminal state. It enables SGR
 * mouse reporting (1000 + 1006), reads for a few seconds, then disables it in a
 * `finally`, so the terminal is restored even if this script is interrupted.
 */

export {};

const SOCKET = process.env["PODTUI_SOCKET"] ?? "/tmp/podtui-dev/podman.sock";
const MOUSE_WINDOW_MS = 5000;

const line = (label: string, value: string): void => {
  process.stdout.write(`${label.padEnd(22)}${value}\n`);
};

process.stdout.write("\n== versions ==\n");
line("bun", Bun.version);
try {
  const res = await fetch("http://d/v5.0.0/libpod/version", { unix: SOCKET } as never);
  const body = (await res.json()) as {
    Components?: { Name?: string; Version?: string }[];
  };
  const engine = body.Components?.find((c) => c.Name === "Podman Engine");
  line("podman (API)", engine?.Version ?? "unknown");
} catch {
  line("podman (API)", `unreachable at ${SOCKET}`);
}

process.stdout.write("\n== terminal identity (whatever the env exposes) ==\n");
// Printed as-is rather than interpreted: guessing which variable means what is
// exactly the kind of assumption this project forbids. An unset line is itself
// the finding.
const TERMINAL_VARS = [
  "TERM",
  "COLORTERM",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "VTE_VERSION",
  "KITTY_WINDOW_ID",
  "KITTY_LISTEN_ON",
  "GHOSTTY_RESOURCES_DIR",
  "GHOSTTY_BIN_DIR",
  "WT_SESSION",
  "ALACRITTY_LOG",
  "WEZTERM_PANE",
  "TMUX",
  "STY",
  "SSH_TTY",
  "DISPLAY",
  "WAYLAND_DISPLAY",
];
for (const name of TERMINAL_VARS) {
  const value = process.env[name];
  if (value !== undefined && value !== "") line(name, value);
}

process.stdout.write("\n== truecolor ==\n");
line("COLORTERM", process.env["COLORTERM"] ?? "(unset)");
process.stdout.write(
  "Emitting a 24-bit gradient (ESC[38;2;r;g;b). If the right-hand end looks\n" +
    "banded or muddy rather than smoothly red, your terminal is NOT truecolor.\n\n",
);
const WIDTH = 64;
for (let row = 0; row < 3; row++) {
  let out = "";
  for (let i = 0; i < WIDTH; i++) {
    const t = i / (WIDTH - 1);
    const r = Math.round(255 * t);
    const g = row === 0 ? 40 : row === 1 ? Math.round(255 * t) : 20;
    const b = row === 2 ? Math.round(255 * t) : 30;
    out += `[38;2;${r};${g};${b}m█`;
  }
  process.stdout.write(`${out}[0m\n`);
}
process.stdout.write("\n");
// A 16-colour control strip: if this and the gradient look identical, something
// is downsampling and the gradient test above is not trustworthy.
let basic = "";
for (let i = 0; i < 16; i++) basic += `[48;5;${i}m  [0m`;
process.stdout.write(`16-colour strip: ${basic}\n`);

if (!process.stdin.isTTY) {
  process.stdout.write(
    "\nSkipping the mouse probe: stdin is not a TTY. Run this in a real terminal.\n",
  );
  process.exit(1);
}

process.stdout.write(
  "== SGR mouse reporting ==\n" +
    `Move the mouse over this window for ${MOUSE_WINDOW_MS / 1000}s...\n` +
    "(No need to click. If nothing is captured, that is a finding too.)\n\n",
);

const ENABLE = "[?1000h[?1006h";
const DISABLE = "[?1006l[?1000l";

const show = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, "0")}`))
    .join("");

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write(ENABLE);

const captured: string[] = [];
const onData = (chunk: Buffer): void => {
  captured.push(show(chunk));
};

const started = Date.now();
process.stdin.on("data", onData);

try {
  while (Date.now() - started < MOUSE_WINDOW_MS) {
    await Bun.sleep(100);
  }
} finally {
  process.stdin.off("data", onData);
  process.stdout.write(DISABLE);
  process.stdin.setRawMode(false);
  process.stdin.pause();
}

process.stdout.write(`\nsequences received: ${captured.length}\n`);
for (const [i, seq] of captured.entries()) {
  process.stdout.write(`  ${String(i + 1).padStart(3)}: ${seq.slice(0, 160)}\n`);
}
if (captured.length === 0) {
  process.stdout.write(
    "  (nothing — mouse reporting did not reach this process; record as untested)\n",
  );
} else {
  process.stdout.write(
    "\nLook for the SGR form: ESC[<button;x;yM (press) / ESC[<button;x;ym (release).\n" +
      "That is what 'SGR mouse' means; the older X10 form would be ESC[M with a\n" +
      "single packed coordinate byte instead.\n",
  );
}
process.stdout.write("\n");