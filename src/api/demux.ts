export type LogStream = "stdin" | "stdout" | "stderr";

export interface LogFrame {
  stream: LogStream;
  timestamp: Date;
  message: string;
}

const STREAM_TYPE_MAP: Record<number, LogStream> = {
  0: "stdin",
  1: "stdout",
  2: "stderr",
};

function getStreamType(buffer: Uint8Array, offset: number): number {
  const val = buffer.at(offset);
  return val ?? 1;
}

const TIMESTAMP_PREFIX = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)( ?)/;

/** Leading ASCII bytes of `payload` as a string (stops at the first non-ASCII byte). */
function asciiHead(payload: Uint8Array, max: number): string {
  let out = "";
  for (let i = 0; i < payload.length && i < max; i++) {
    const b = payload[i] ?? 0;
    if (b >= 0x80) break;
    out += String.fromCharCode(b);
  }
  return out;
}

/**
 * Split Podman's `timestamps=true` prefix off the raw payload. The prefix is
 * ASCII, so its string length equals its byte length and the remaining bytes
 * can be handed to a streaming decoder untouched.
 */
function splitTimestamp(payload: Uint8Array): { timestamp: Date; body: Uint8Array } {
  const match = TIMESTAMP_PREFIX.exec(asciiHead(payload, 64));
  // Podman separates the timestamp with exactly ONE space. Anything after it
  // is payload: an empty line is the frame `"<ts> \n"`, and a greedy `\s*`
  // here once swallowed that `\n` (fixture container-logs-partial-lines.bin).
  if (!match?.[1] || match[4] !== " ") {
    return { timestamp: new Date(), body: payload };
  }
  return { timestamp: new Date(match[1]), body: payload.subarray(match[0].length) };
}

interface RawFrame {
  stream: LogStream;
  payload: Uint8Array;
  bytesConsumed: number;
}

function readRawFrame(buffer: Uint8Array, offset: number): RawFrame | null {
  if (offset + 8 > buffer.length) return null;
  const stream = STREAM_TYPE_MAP[getStreamType(buffer, offset)] ?? "stdout";
  const b4 = buffer.at(offset + 4) ?? 0;
  const b5 = buffer.at(offset + 5) ?? 0;
  const b6 = buffer.at(offset + 6) ?? 0;
  const b7 = buffer.at(offset + 7) ?? 0;
  const length = (b4 << 24) | (b5 << 16) | (b6 << 8) | b7;
  const frameStart = offset + 8;
  const frameEnd = frameStart + length;
  if (frameEnd > buffer.length) return null;
  return { stream, payload: buffer.subarray(frameStart, frameEnd), bytesConsumed: frameEnd - offset };
}

/**
 * Decode ONE frame in isolation. A multi-byte character split across frames
 * cannot be decoded this way (it becomes U+FFFD); streams must use
 * `MultiplexedLogDecoder`, which carries partial characters per stream.
 */
export function decodeMultiplexedFrame(buffer: Uint8Array, offset = 0): { frame: LogFrame | null; bytesConsumed: number } {
  const raw = readRawFrame(buffer, offset);
  if (!raw) return { frame: null, bytesConsumed: 0 };
  const { timestamp, body } = splitTimestamp(raw.payload);
  return {
    frame: { stream: raw.stream, timestamp, message: new TextDecoder().decode(body) },
    bytesConsumed: raw.bytesConsumed,
  };
}

/**
 * Incremental decoder for a multiplexed log stream.
 *
 * conmon writes one frame per container `write()`, so a multi-byte UTF-8
 * character can straddle two frames (recorded: `test/fixtures/
 * container-logs-utf8-split.bin`). Each stream therefore has its own
 * streaming `TextDecoder` that holds an incomplete character until its
 * remaining bytes arrive.
 */
export class MultiplexedLogDecoder {
  private buffer = new Uint8Array(0);
  private text: Partial<Record<LogStream, TextDecoder>> = {};

  private textDecoder(stream: LogStream): TextDecoder {
    let d = this.text[stream];
    if (!d) {
      d = new TextDecoder();
      this.text[stream] = d;
    }
    return d;
  }

  append(chunk: Uint8Array): void {
    const newBuffer = new Uint8Array(this.buffer.length + chunk.length);
    newBuffer.set(this.buffer);
    newBuffer.set(chunk, this.buffer.length);
    this.buffer = newBuffer;
  }

  decode(): LogFrame[] {
    const frames: LogFrame[] = [];
    let offset = 0;

    while (offset < this.buffer.length) {
      const raw = readRawFrame(this.buffer, offset);
      if (!raw) break;
      const { timestamp, body } = splitTimestamp(raw.payload);
      const message = this.textDecoder(raw.stream).decode(body, { stream: true });
      // A frame holding only the first byte(s) of a character yields "" here;
      // its text arrives with the next frame of the same stream.
      if (message !== "" || body.length === 0) frames.push({ stream: raw.stream, timestamp, message });
      offset += raw.bytesConsumed;
    }

    if (offset > 0) {
      this.buffer = this.buffer.subarray(offset);
    }

    return frames;
  }

  clear(): void {
    this.buffer = new Uint8Array(0);
    this.text = {};
  }

  get bufferLength(): number {
    return this.buffer.length;
  }
}

export function isMultiplexedStream(data: Uint8Array): boolean {
  if (data.length < 8) return false;
  const streamType = data.at(0) ?? 255;
  return streamType <= 2 && data[1] === 0 && data[2] === 0 && data[3] === 0;
}