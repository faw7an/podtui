import { classifyLogLine, type LogLevel } from "./logLevel.ts";

/**
 * Bounded store of log LINES built from log FRAMES (P3-T2).
 *
 * Verified framing (DECISIONS 2026-10-08 phase-3/log-frames): a frame carries
 * at most one line, but one line can span several frames — a write without a
 * trailing `\n` arrives on its own and the rest follows in later frames. So a
 * line stays "open" until its `\n` arrives, per stream (stdout and stderr
 * interleave independently). TTY lines end in `\r\n`; the `\r` is dropped.
 *
 * Every line gets a sequence number that never repeats, so a view can keep its
 * place by sequence even while the ring drops the oldest lines.
 */

export type LogStreamName = "stdin" | "stdout" | "stderr";

export interface LogInput {
  stream: LogStreamName;
  timestamp: Date;
  message: string;
}

export interface LogLine {
  /** Monotonic, never reused. */
  readonly seq: number;
  text: string;
  readonly stream: LogStreamName;
  /** Timestamp of the frame that started the line. */
  readonly timestamp: Date;
  level: LogLevel;
  /** False while the line still waits for its `\n`. */
  complete: boolean;
}

export const DEFAULT_LOG_LINES = 5000;

/**
 * Longer lines are cut so one runaway line cannot hold megabytes; the cut is
 * marked so it is never mistaken for the real end of the line.
 */
export const MAX_LINE_CHARS = 16_384;
export const TRUNCATED_MARK = " … [line truncated]";

export class LogBuffer {
  readonly capacity: number;
  private ring: (LogLine | undefined)[];
  private head = 0; // index of the oldest line
  private count = 0;
  private seq = 0;
  private open: Partial<Record<LogStreamName, LogLine>> = {};
  /** Open lines already cut at MAX_LINE_CHARS: further text is discarded. */
  private truncated = new WeakSet<LogLine>();

  constructor(capacity = DEFAULT_LOG_LINES) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.ring = new Array<LogLine | undefined>(this.capacity);
  }

  /** Sequence number of the oldest line still held. */
  get firstSeq(): number {
    return this.seq - this.count;
  }

  /** One past the newest line's sequence number. */
  get nextSeq(): number {
    return this.seq;
  }

  get length(): number {
    return this.count;
  }

  /** Lines dropped because the ring was full (the "memory bounded" proof). */
  get dropped(): number {
    return this.firstSeq;
  }

  at(seq: number): LogLine | undefined {
    if (seq < this.firstSeq || seq >= this.seq) return undefined;
    return this.ring[(this.head + (seq - this.firstSeq)) % this.capacity];
  }

  /** Lines with `from <= seq < to`, clamped to what is held. */
  slice(from: number, to: number): LogLine[] {
    const out: LogLine[] = [];
    const start = Math.max(from, this.firstSeq);
    const end = Math.min(to, this.seq);
    for (let s = start; s < end; s++) {
      const line = this.at(s);
      if (line) out.push(line);
    }
    return out;
  }

  push(frame: LogInput): void {
    const parts = frame.message.split("\n");
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      // A trailing "" after the final `\n` means "line closed, nothing open".
      if (last && part === "") return;
      this.write(frame, part, !last);
    });
  }

  clear(): void {
    this.ring = new Array<LogLine | undefined>(this.capacity);
    this.head = 0;
    this.count = 0;
    this.open = {};
    // `seq` keeps counting: a view anchored to an old sequence must not land
    // on a new, unrelated line.
  }

  private write(frame: LogInput, text: string, closes: boolean): void {
    const open = this.open[frame.stream];
    let line: LogLine;
    if (open && open.seq >= this.firstSeq) {
      line = open;
      if (!this.truncated.has(line)) line.text = this.cap(line, line.text + text);
    } else {
      line = {
        seq: this.seq,
        text: "",
        stream: frame.stream,
        timestamp: frame.timestamp,
        level: "unknown",
        complete: false,
      };
      line.text = this.cap(line, text);
      this.append(line);
    }
    if (closes) {
      if (line.text.endsWith("\r")) line.text = line.text.slice(0, -1);
      line.complete = true;
      delete this.open[frame.stream];
    } else {
      this.open[frame.stream] = line;
    }
    line.level = classifyLogLine(line.text);
  }

  private cap(line: LogLine, text: string): string {
    if (text.length <= MAX_LINE_CHARS) return text;
    this.truncated.add(line);
    return text.slice(0, MAX_LINE_CHARS - TRUNCATED_MARK.length) + TRUNCATED_MARK;
  }

  private append(line: LogLine): void {
    if (this.count < this.capacity) {
      this.ring[(this.head + this.count) % this.capacity] = line;
      this.count++;
    } else {
      this.ring[this.head] = line;
      this.head = (this.head + 1) % this.capacity;
    }
    this.seq++;
  }
}

