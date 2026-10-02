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

export function decodeMultiplexedFrame(buffer: Uint8Array, offset = 0): { frame: LogFrame | null; bytesConsumed: number } {
  if (offset + 8 > buffer.length) {
    return { frame: null, bytesConsumed: 0 };
  }

  const streamType = getStreamType(buffer, offset);
  const stream = STREAM_TYPE_MAP[streamType] ?? "stdout";

  const b4 = buffer.at(offset + 4) ?? 0;
  const b5 = buffer.at(offset + 5) ?? 0;
  const b6 = buffer.at(offset + 6) ?? 0;
  const b7 = buffer.at(offset + 7) ?? 0;

  const length = (b4 << 24) | (b5 << 16) | (b6 << 8) | b7;

  const frameStart = offset + 8;
  const frameEnd = frameStart + length;

  if (frameEnd > buffer.length) {
    return { frame: null, bytesConsumed: 0 };
  }

  const message = new TextDecoder().decode(buffer.subarray(frameStart, frameEnd));
  const timestamp = extractTimestamp(message);

  return {
    frame: { stream, timestamp, message: message.replace(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?\s*/, "") },
    bytesConsumed: frameEnd - offset,
  };
}

function extractTimestamp(message: string): Date {
  const match = message.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)\s/);
  if (match && match[1]) {
    return new Date(match[1]);
  }
  return new Date();
}

export class MultiplexedLogDecoder {
  private buffer = new Uint8Array(0);

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
      const result = decodeMultiplexedFrame(this.buffer, offset);
      if (!result.frame || result.bytesConsumed === 0) {
        break;
      }
      frames.push(result.frame);
      offset += result.bytesConsumed;
    }

    if (offset > 0) {
      this.buffer = this.buffer.subarray(offset);
    }

    return frames;
  }

  clear(): void {
    this.buffer = new Uint8Array(0);
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