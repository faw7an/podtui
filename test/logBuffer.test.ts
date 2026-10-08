/**
 * Tests for `src/util/logBuffer.ts` (P3-T2): ring overflow, partial-line
 * joining as recorded from the real socket, TTY `\r\n`, and memory bounds.
 */

import { describe, expect, test } from "bun:test";
import { MultiplexedLogDecoder } from "../src/api/demux.ts";
import {
  LogBuffer,
  MAX_LINE_CHARS,
  TRUNCATED_MARK,
  type LogInput,
} from "../src/util/logBuffer.ts";

const T = new Date("2026-10-08T10:00:00Z");
const out = (message: string): LogInput => ({ stream: "stdout", timestamp: T, message });
const err = (message: string): LogInput => ({ stream: "stderr", timestamp: T, message });
const texts = (b: LogBuffer): string[] => b.slice(b.firstSeq, b.nextSeq).map((l) => l.text);

async function replay(fixture: string): Promise<LogBuffer> {
  const bytes = new Uint8Array(await Bun.file(`test/fixtures/${fixture}`).arrayBuffer());
  const decoder = new MultiplexedLogDecoder();
  const buffer = new LogBuffer();
  decoder.append(bytes);
  for (const frame of decoder.decode()) buffer.push(frame);
  return buffer;
}

describe("LogBuffer: lines from frames", () => {
  test("one complete line per frame", () => {
    const b = new LogBuffer();
    b.push(out("one\n"));
    b.push(out("two\n"));
    expect(texts(b)).toEqual(["one", "two"]);
    expect(b.at(0)?.complete).toBe(true);
  });

  test("a partial frame stays open and is joined by the next frame", () => {
    const b = new LogBuffer();
    b.push(out("partial-"));
    expect(texts(b)).toEqual(["partial-"]);
    expect(b.at(0)?.complete).toBe(false);
    b.push(out("end\n"));
    expect(texts(b)).toEqual(["partial-end"]);
    expect(b.at(0)?.complete).toBe(true);
    expect(b.length).toBe(1);
  });

  test("stdout and stderr keep separate open lines", () => {
    const b = new LogBuffer();
    b.push(out("a"));
    b.push(err("ERROR x\n"));
    b.push(out("b\n"));
    expect(texts(b)).toEqual(["ab", "ERROR x"]);
    expect(b.at(1)?.stream).toBe("stderr");
  });

  test("several lines in one message are split (defensive; not seen live)", () => {
    const b = new LogBuffer();
    b.push(out("x\ny\nz"));
    expect(texts(b)).toEqual(["x", "y", "z"]);
    expect(b.at(2)?.complete).toBe(false);
  });

  test("an empty line is kept", () => {
    const b = new LogBuffer();
    b.push(out("\n"));
    expect(texts(b)).toEqual([""]);
  });

  test("level is classified, and re-classified as an open line grows", () => {
    const b = new LogBuffer();
    b.push(out("2026 "));
    expect(b.at(0)?.level).toBe("unknown");
    b.push(out("ERROR boom\n"));
    expect(b.at(0)?.level).toBe("error");
  });
});

describe("LogBuffer: recorded fixtures", () => {
  test("partial-lines fixture: writes without newline join into one line", async () => {
    const b = await replay("container-logs-partial-lines.bin");
    const lines = texts(b);
    expect(lines.slice(0, 4)).toEqual(["one", "two", "three", "partial-end"]);
    // `no-newline-at-exit` + 20,000 x's arrived as 9 frames, then "\n".
    expect(lines[4]?.startsWith("no-newline-at-exitxxx")).toBe(true);
    // 20,018 chars, so the MAX_LINE_CHARS cap applies.
    expect(lines[4]?.length).toBe(MAX_LINE_CHARS);
    expect(lines[4]?.endsWith(TRUNCATED_MARK)).toBe(true);
    expect(lines[5]).toBe("café");
    expect(lines).toHaveLength(6);
  });

  test("tty fixture: \\r\\n endings lose the \\r, ANSI kept raw", async () => {
    const b = await replay("container-logs-tty.bin");
    expect(texts(b)).toEqual(["tty1", "tty2", "\x1b[31mred\x1b[0m"]);
  });

  test("utf8-split fixture", async () => {
    const b = await replay("container-logs-utf8-split.bin");
    expect(texts(b)).toEqual(["café ok"]);
  });
});

describe("LogBuffer: ring", () => {
  test("overflow drops the oldest and keeps sequence numbers", () => {
    const b = new LogBuffer(3);
    for (let i = 0; i < 5; i++) b.push(out(`l${i}\n`));
    expect(texts(b)).toEqual(["l2", "l3", "l4"]);
    expect(b.firstSeq).toBe(2);
    expect(b.nextSeq).toBe(5);
    expect(b.dropped).toBe(2);
    expect(b.at(1)).toBeUndefined();
    expect(b.at(4)?.text).toBe("l4");
  });

  test("slice clamps to what is held", () => {
    const b = new LogBuffer(3);
    for (let i = 0; i < 5; i++) b.push(out(`l${i}\n`));
    expect(b.slice(0, 100).map((l) => l.seq)).toEqual([2, 3, 4]);
    expect(b.slice(3, 4).map((l) => l.text)).toEqual(["l3"]);
    expect(b.slice(9, 12)).toEqual([]);
  });

  test("an open line evicted by the ring is not resurrected", () => {
    const b = new LogBuffer(2);
    b.push(out("open"));
    b.push(err("e1\n"));
    b.push(err("e2\n")); // evicts the open stdout line
    b.push(out("-rest\n"));
    expect(texts(b)).toEqual(["e2", "-rest"]);
  });

  test("memory stays bounded under a flood: 100k lines, capacity held", () => {
    const b = new LogBuffer(5000);
    for (let i = 0; i < 100_000; i++) b.push(out(`line ${i}\n`));
    expect(b.length).toBe(5000);
    expect(b.firstSeq).toBe(95_000);
    expect(b.at(99_999)?.text).toBe("line 99999");
  });

  test("a runaway line is cut at MAX_LINE_CHARS and stays cut", () => {
    const b = new LogBuffer();
    const chunk = "x".repeat(10_000);
    b.push(out(chunk));
    b.push(out(chunk));
    b.push(out(chunk + "\n"));
    const text = b.at(0)?.text ?? "";
    expect(text.length).toBe(MAX_LINE_CHARS);
    expect(text.endsWith(TRUNCATED_MARK)).toBe(true);
    expect(b.length).toBe(1);
    expect(b.at(0)?.complete).toBe(true);
  });

  test("clear empties the buffer but never reuses sequence numbers", () => {
    const b = new LogBuffer();
    b.push(out("a\n"));
    b.push(out("open"));
    b.clear();
    expect(b.length).toBe(0);
    b.push(out("tail\n"));
    expect(texts(b)).toEqual(["tail"]);
    expect(b.at(2)?.text).toBe("tail");
  });
});

describe("LogBuffer: a source-provided level (journald priority, P6)", () => {
  test("raises the level, never lowers it", () => {
    const b = new LogBuffer();
    b.push({ stream: "stdout", timestamp: T, message: "disk full\n", level: "error" });
    b.push({ stream: "stdout", timestamp: T, message: "ERROR boom\n", level: "info" });
    b.push({ stream: "stdout", timestamp: T, message: "plain\n" });
    expect([0, 1, 2].map((i) => b.at(i)?.level)).toEqual(["error", "error", "unknown"]);
  });
});
