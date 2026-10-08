import { test, expect, describe } from "bun:test";
import {
  decodeMultiplexedFrame,
  MultiplexedLogDecoder,
  isMultiplexedStream,
} from "../src/api/demux.ts";

function encodeFrame(stream: 0 | 1 | 2, payload: string): Uint8Array {
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(payload);
  const frame = new Uint8Array(8 + payloadBytes.length);
  frame[0] = stream;
  frame[1] = 0;
  frame[2] = 0;
  frame[3] = 0;
  frame[4] = (payloadBytes.length >>> 24) & 0xff;
  frame[5] = (payloadBytes.length >>> 16) & 0xff;
  frame[6] = (payloadBytes.length >>> 8) & 0xff;
  frame[7] = payloadBytes.length & 0xff;
  frame.set(payloadBytes, 8);
  return frame;
}

describe("decodeMultiplexedFrame", () => {
  test("decodes single stdout frame", () => {
    const frame = encodeFrame(1, "hello world\n");
    const result = decodeMultiplexedFrame(frame);
    expect(result.frame).not.toBeNull();
    expect(result.frame!.stream).toBe("stdout");
    expect(result.frame!.message).toBe("hello world\n");
    expect(result.bytesConsumed).toBe(frame.length);
  });

  test("decodes single stderr frame", () => {
    const frame = encodeFrame(2, "error message\n");
    const result = decodeMultiplexedFrame(frame);
    expect(result.frame).not.toBeNull();
    expect(result.frame!.stream).toBe("stderr");
    expect(result.frame!.message).toBe("error message\n");
  });

  test("decodes stdin frame", () => {
    const frame = encodeFrame(0, "input data\n");
    const result = decodeMultiplexedFrame(frame);
    expect(result.frame).not.toBeNull();
    expect(result.frame!.stream).toBe("stdin");
    expect(result.frame!.message).toBe("input data\n");
  });

  test("decodes multiple frames in one buffer", () => {
    const frame1 = encodeFrame(1, "line 1\n");
    const frame2 = encodeFrame(2, "error line\n");
    const frame3 = encodeFrame(1, "line 3\n");
    const buffer = new Uint8Array(frame1.length + frame2.length + frame3.length);
    buffer.set(frame1, 0);
    buffer.set(frame2, frame1.length);
    buffer.set(frame3, frame1.length + frame2.length);

    const result1 = decodeMultiplexedFrame(buffer, 0);
    expect(result1.frame!.message).toBe("line 1\n");
    expect(result1.bytesConsumed).toBe(frame1.length);

    const result2 = decodeMultiplexedFrame(buffer, result1.bytesConsumed);
    expect(result2.frame!.stream).toBe("stderr");
    expect(result2.frame!.message).toBe("error line\n");
    expect(result2.bytesConsumed).toBe(frame2.length);

    const result3 = decodeMultiplexedFrame(buffer, result1.bytesConsumed + result2.bytesConsumed);
    expect(result3.frame!.message).toBe("line 3\n");
    expect(result3.bytesConsumed).toBe(frame3.length);
  });

  test("returns null for incomplete header", () => {
    const buffer = new Uint8Array([1, 0, 0, 0]);
    const result = decodeMultiplexedFrame(buffer);
    expect(result.frame).toBeNull();
    expect(result.bytesConsumed).toBe(0);
  });

  test("returns null for incomplete payload", () => {
    const frame = encodeFrame(1, "hello world\n");
    const incomplete = frame.subarray(0, frame.length - 3);
    const result = decodeMultiplexedFrame(incomplete);
    expect(result.frame).toBeNull();
    expect(result.bytesConsumed).toBe(0);
  });

  test("handles zero-length payload", () => {
    const frame = encodeFrame(1, "");
    const result = decodeMultiplexedFrame(frame);
    expect(result.frame).not.toBeNull();
    expect(result.frame!.message).toBe("");
    expect(result.bytesConsumed).toBe(8);
  });

  test("extracts timestamp from message", () => {
    const payload = "2026-10-02T13:09:18Z log message\n";
    const frame = encodeFrame(1, payload);
    const result = decodeMultiplexedFrame(frame);
    expect(result.frame).not.toBeNull();
    expect(result.frame!.message).toBe("log message\n");
    expect(result.frame!.timestamp).toBeInstanceOf(Date);
  });

  test("handles timestamp with timezone offset", () => {
    const payload = "2026-10-02T13:09:18+03:00 log message\n";
    const frame = encodeFrame(1, payload);
    const result = decodeMultiplexedFrame(frame);
    expect(result.frame).not.toBeNull();
    expect(result.frame!.message).toBe("log message\n");
  });
});

describe("MultiplexedLogDecoder", () => {
  test("decodes single complete frame", () => {
    const decoder = new MultiplexedLogDecoder();
    const frame = encodeFrame(1, "hello\n");
    decoder.append(frame);
    const frames = decoder.decode();
    expect(frames).toHaveLength(1);
    expect(frames.at(0)?.message).toBe("hello\n");
  });

  test("decodes multiple frames appended at once", () => {
    const decoder = new MultiplexedLogDecoder();
    const frame1 = encodeFrame(1, "line 1\n");
    const frame2 = encodeFrame(2, "error\n");
    const frame3 = encodeFrame(1, "line 3\n");
    const buffer = new Uint8Array(frame1.length + frame2.length + frame3.length);
    buffer.set(frame1, 0);
    buffer.set(frame2, frame1.length);
    buffer.set(frame3, frame1.length + frame2.length);
    decoder.append(buffer);
    const frames = decoder.decode();
    expect(frames).toHaveLength(3);
    expect(frames.at(0)?.message).toBe("line 1\n");
    expect(frames.at(1)?.stream).toBe("stderr");
    expect(frames.at(2)?.message).toBe("line 3\n");
  });

  test("handles header split across chunks", () => {
    const decoder = new MultiplexedLogDecoder();
    const frame = encodeFrame(1, "split header test\n");
    const header = frame.subarray(0, 4);
    const rest = frame.subarray(4);
    decoder.append(header);
    let frames = decoder.decode();
    expect(frames).toHaveLength(0);
    expect(decoder.bufferLength).toBe(4);
    decoder.append(rest);
    frames = decoder.decode();
    expect(frames).toHaveLength(1);
    expect(frames.at(0)?.message).toBe("split header test\n");
  });

  test("handles payload split across chunks", () => {
    const decoder = new MultiplexedLogDecoder();
    const frame = encodeFrame(1, "this is a long payload that will be split\n");
    const splitPoint = 10;
    const firstChunk = frame.subarray(0, splitPoint);
    const secondChunk = frame.subarray(splitPoint);
    decoder.append(firstChunk);
    let frames = decoder.decode();
    expect(frames).toHaveLength(0);
    decoder.append(secondChunk);
    frames = decoder.decode();
    expect(frames).toHaveLength(1);
    expect(frames.at(0)?.message).toBe("this is a long payload that will be split\n");
  });

  test("handles frame split across multiple small chunks", () => {
    const decoder = new MultiplexedLogDecoder();
    const frame = encodeFrame(1, "chunked\n");
    for (let i = 0; i < frame.length; i += 2) {
      decoder.append(frame.subarray(i, Math.min(i + 2, frame.length)));
    }
    const frames = decoder.decode();
    expect(frames).toHaveLength(1);
    expect(frames.at(0)?.message).toBe("chunked\n");
  });

  test("handles multiple frames with partial chunks", () => {
    const decoder = new MultiplexedLogDecoder();
    const frame1 = encodeFrame(1, "first\n");
    const frame2 = encodeFrame(2, "second\n");
    const combined = new Uint8Array(frame1.length + frame2.length);
    combined.set(frame1, 0);
    combined.set(frame2, frame1.length);

    decoder.append(combined.subarray(0, 4));
    let frames = decoder.decode();
    expect(frames).toHaveLength(0);

    decoder.append(combined.subarray(4, 10));
    frames = decoder.decode();
    expect(frames).toHaveLength(0);

    decoder.append(combined.subarray(10));
    frames = decoder.decode();
    expect(frames).toHaveLength(2);
    expect(frames.at(0)?.message).toBe("first\n");
    expect(frames.at(1)?.message).toBe("second\n");
  });

  test("clear resets buffer", () => {
    const decoder = new MultiplexedLogDecoder();
    decoder.append(encodeFrame(1, "test\n"));
    decoder.clear();
    expect(decoder.bufferLength).toBe(0);
    const frames = decoder.decode();
    expect(frames).toHaveLength(0);
  });
});

describe("isMultiplexedStream", () => {
  test("returns true for valid multiplexed frame header", () => {
    const frame = encodeFrame(1, "test");
    expect(isMultiplexedStream(frame)).toBe(true);
  });

  test("returns true for stderr frame", () => {
    const frame = encodeFrame(2, "error");
    expect(isMultiplexedStream(frame)).toBe(true);
  });

  test("returns false for empty buffer", () => {
    expect(isMultiplexedStream(new Uint8Array(0))).toBe(false);
  });

  test("returns false for buffer smaller than header", () => {
    expect(isMultiplexedStream(new Uint8Array([1, 0, 0]))).toBe(false);
  });

  test("returns false for invalid stream type", () => {
    const frame = new Uint8Array([5, 0, 0, 0, 0, 0, 0, 4, 116, 101, 115, 116]);
    expect(isMultiplexedStream(frame)).toBe(false);
  });
});

describe("real fixture test", () => {
  test("decodes real multiplexed log from fixture", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const fixturePath = path.join(import.meta.dirname, "fixtures", "container-logs-multiplexed.bin");
    const data = new Uint8Array(fs.readFileSync(fixturePath));
    
    expect(data.length).toBeGreaterThan(0);
    expect(isMultiplexedStream(data)).toBe(true);

    const decoder = new MultiplexedLogDecoder();
    decoder.append(data);
    const frames = decoder.decode();
    
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(["stdout", "stderr", "stdin"]).toContain(frame.stream);
      expect(frame.message).toBeDefined();
      expect(frame.timestamp).toBeInstanceOf(Date);
    }
  });

  test("decodes running container multiplexed log from fixture", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const fixturePath = path.join(import.meta.dirname, "fixtures", "container-logs-running-multiplexed.bin");
    const data = new Uint8Array(fs.readFileSync(fixturePath));
    
    expect(data.length).toBeGreaterThan(0);
    expect(isMultiplexedStream(data)).toBe(true);

    const decoder = new MultiplexedLogDecoder();
    decoder.append(data);
    const frames = decoder.decode();
    
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(["stdout", "stderr", "stdin"]).toContain(frame.stream);
      expect(frame.message).toBeDefined();
    }
  });
});
describe("UTF-8 split across frames (recorded live, Podman 5.8.4)", () => {
  // `printf "caf\303"; sleep 1; printf "\251 ok\n"` in a container: conmon
  // emits one frame per write, so `é` (C3 A9) straddles two frames. Decoding
  // each frame on its own turned it into two U+FFFD characters.
  test("the decoder joins the character instead of emitting U+FFFD", async () => {
    const bytes = new Uint8Array(await Bun.file("test/fixtures/container-logs-utf8-split.bin").arrayBuffer());
    const decoder = new MultiplexedLogDecoder();
    decoder.append(bytes);
    const text = decoder.decode().map((f) => f.message).join("");
    expect(text).not.toContain("�");
    expect(text).toBe("café ok\n");
  });

  test("also when the split frames arrive in separate chunks", async () => {
    const bytes = new Uint8Array(await Bun.file("test/fixtures/container-logs-utf8-split.bin").arrayBuffer());
    const decoder = new MultiplexedLogDecoder();
    let text = "";
    for (let i = 0; i < bytes.length; i += 7) {
      decoder.append(bytes.subarray(i, i + 7));
      text += decoder.decode().map((f) => f.message).join("");
    }
    expect(text).toBe("café ok\n");
  });

  test("stdout and stderr keep separate partial characters", () => {
    const enc = (stream: 1 | 2, payload: number[]): Uint8Array => {
      const f = new Uint8Array(8 + payload.length);
      f[0] = stream;
      f[7] = payload.length;
      f.set(payload, 8);
      return f;
    };
    const decoder = new MultiplexedLogDecoder();
    decoder.append(enc(1, [0x61, 0xc3])); // stdout: "a" + first byte of é
    decoder.append(enc(2, [0x62, 0x0a])); // stderr: "b\n"
    decoder.append(enc(1, [0xa9, 0x0a])); // stdout: second byte of é + "\n"
    const frames = decoder.decode();
    expect(frames.map((f) => [f.stream, f.message])).toEqual([
      ["stdout", "a"],
      ["stderr", "b\n"],
      ["stdout", "é\n"],
    ]);
  });
});
