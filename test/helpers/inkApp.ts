import { EventEmitter } from "node:events";

/**
 * Fake terminal for driving the real `App` under Ink in tests. Same approach
 * as `test/filter-app.test.tsx` (ink-testing-library cannot run hooks under
 * React 19, see DECISIONS phase-2/filter-ux): a TTY-looking stdout that
 * splits frames on Ink's per-frame hide-cursor sequence, and a readable-
 * protocol stdin.
 */

const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, "g");
const HIDE_CURSOR = `${ESC}[?25l`;
const BRAND = "▲ podtui";

export class FakeStdout extends EventEmitter {
  columns: number;
  rows: number;
  readonly isTTY = true;
  private buffer = "";

  constructor(columns: number, rows: number) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  write = (chunk: string): boolean => {
    this.buffer += chunk;
    return true;
  };

  /**
   * Latest frame, ANSI stripped. Every podtui frame begins with the header
   * brand, and Ink does not always emit a hide-cursor between frames, so the
   * brand is the reliable boundary; the hide-cursor split is the fallback.
   */
  frame(): string {
    const stripped = this.buffer.replaceAll(ANSI_RE, "");
    const at = stripped.lastIndexOf(BRAND);
    if (at >= 0) return stripped.slice(at);
    const frames = stripped.split(HIDE_CURSOR).filter((f) => f.length > 0);
    return frames.at(-1) ?? stripped;
  }

  /** Everything written so far, escapes included (for colour assertions). */
  raw(): string {
    return this.buffer;
  }

  drain(): void {
    this.buffer = "";
  }
}

export class FakeStdin extends EventEmitter {
  readonly isTTY = true;
  readonly readable = true;
  private chunks: string[] = [];

  /* Test doubles: a real terminal owns raw mode, encoding and flow. */
  setRawMode(): void {
    /* test double */
  }
  setEncoding(): void {
    /* test double */
  }
  resume(): void {
    /* test double */
  }
  pause(): void {
    /* test double */
  }
  ref(): void {
    /* test double */
  }
  unref(): void {
    /* test double */
  }

  read(): string | null {
    return this.chunks.shift() ?? null;
  }

  type(text: string): void {
    this.chunks.push(text);
    this.emit("readable");
  }
}

export async function waitFor(cond: () => boolean, what: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (cond()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
