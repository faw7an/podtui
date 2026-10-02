import { describe, expect, test } from "bun:test";
import {
  center,
  displayWidth,
  fill,
  fit,
  padLeft,
  padRight,
  sliceToWidth,
  truncate,
} from "../src/util/fit";

/** Mirrors the escape-sequence pattern used by src/util/fit.ts. */
const ANSI_PATTERN_G =
  "\\u001B(?:\\[[0-9;?]*[ -/]*[@-~]|\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)|[ -/]*[@-Z\\\\-_])";

const SAMPLES = [
  "",
  "a",
  "hello",
  "a very long container name that will not fit at all",
  "日本語",
  "日本語テスト",
  "🐳",
  "🐳🐳",
  "👨‍👩‍👧‍👦",
  "é",
  "é́",
  "café",
  "naïve",
  "\u001B[31mred\u001B[0m",
  "\u001B[1m\u001B[32mbold green\u001B[0m",
];

describe("displayWidth", () => {
  test("ignores ANSI escape sequences", () => {
    expect(displayWidth("\u001B[31mred\u001B[0m")).toBe(3);
    // Raw JS length counts the escape bytes; display width does not.
    expect("\u001B[31mred\u001B[0m".length).toBe(12);
    expect(displayWidth("\u001B[31mred\u001B[0m")).toBe(3);
  });

  test("counts wide glyphs as two cells", () => {
    expect(displayWidth("日本語")).toBe(6);
    expect(displayWidth("🐳")).toBe(2);
    expect(displayWidth("👨‍👩‍👧‍👦")).toBe(2);
  });

  test("counts combining marks as zero", () => {
    expect(displayWidth("é")).toBe(1);
    expect(displayWidth("é́")).toBe(1);
  });

  test("handles the empty string", () => {
    expect(displayWidth("")).toBe(0);
  });
});

describe("sliceToWidth", () => {
  test("never exceeds the requested width", () => {
    for (const s of SAMPLES) {
      for (let w = 0; w <= 20; w++) {
        expect(displayWidth(sliceToWidth(s, w))).toBeLessThanOrEqual(w);
      }
    }
  });

  test("returns the whole string when it already fits", () => {
    expect(sliceToWidth("hello", 10)).toBe("hello");
    expect(sliceToWidth("hello", 5)).toBe("hello");
  });

  test("does not split a wide glyph", () => {
    expect(sliceToWidth("日本", 3)).toBe("日");
    expect(displayWidth(sliceToWidth("日本", 3))).toBeLessThanOrEqual(3);
  });
});

describe("truncate", () => {
  test("leaves short strings untouched", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("hello", 5)).toBe("hello");
  });

  test("adds an ellipsis and respects the width", () => {
    expect(truncate("hello world", 8)).toBe("hello w…");
    expect(displayWidth(truncate("hello world", 8))).toBeLessThanOrEqual(8);
  });

  test("handles width 1 and 0", () => {
    expect(truncate("hello", 1)).toBe("…");
    expect(truncate("hello", 0)).toBe("");
    expect(truncate("hello", -5)).toBe("");
  });

  test("never exceeds the width for any sample", () => {
    for (const s of SAMPLES) {
      for (let w = 0; w <= 24; w++) {
        expect(displayWidth(truncate(s, w))).toBeLessThanOrEqual(w);
      }
    }
  });
});

describe("padRight / fit", () => {
  test("pads to exactly the requested width", () => {
    expect(padRight("ab", 5)).toBe("ab   ");
    expect(displayWidth(padRight("ab", 5))).toBe(5);
  });

  test("truncates before padding", () => {
    expect(displayWidth(padRight("abcdefghij", 4))).toBe(4);
  });

  test("fit is padRight", () => {
    for (const s of SAMPLES) {
      for (let w = 0; w <= 24; w++) {
        expect(fit(s, w)).toBe(padRight(s, w));
        expect(displayWidth(fit(s, w))).toBeLessThanOrEqual(Math.max(0, w));
      }
    }
  });

  test("is always exactly the requested width", () => {
    for (const s of SAMPLES) {
      for (let w = 1; w <= 24; w++) {
        expect(displayWidth(fit(s, w))).toBe(w);
      }
    }
  });

  test("returns empty string for non-positive widths", () => {
    expect(fit("hello", 0)).toBe("");
    expect(fit("hello", -1)).toBe("");
  });

  test("preserves ANSI sequences while padding", () => {
    const out = padRight("\u001B[31mred\u001B[0m", 6);
    expect(out).toContain("\u001B[31m");
    expect(out).toContain("\u001B[0m");
    expect(displayWidth(out)).toBe(6);
  });

  test("never truncates an escape sequence in half", () => {
    // Every sample is sliced at every width; the result must still be a valid
    // string whose escapes are complete.
    for (const s of SAMPLES) {
      for (let w = 0; w <= 24; w++) {
        const out = truncate(s, w);
        // No dangling ESC that is not a complete sequence.
        const dangling = out.replace(new RegExp(ANSI_PATTERN_G, "g"), "");
        expect(dangling).not.toContain("\u001B");
      }
    }
  });
});

describe("padLeft / center", () => {
  test("padLeft pads on the left", () => {
    expect(padLeft("ab", 5)).toBe("   ab");
    expect(displayWidth(padLeft("ab", 5))).toBe(5);
  });

  test("center balances the padding", () => {
    expect(center("ab", 6)).toBe("  ab  ");
    expect(center("ab", 5)).toBe(" ab  ");
    expect(displayWidth(center("abcdef", 4))).toBe(4);
  });

  test("both respect the width for every sample", () => {
    for (const s of SAMPLES) {
      for (let w = 0; w <= 24; w++) {
        expect(displayWidth(padLeft(s, w))).toBeLessThanOrEqual(w);
        expect(displayWidth(center(s, w))).toBeLessThanOrEqual(w);
      }
    }
  });
});

describe("fill", () => {
  test("fills to exactly the requested width", () => {
    expect(fill("ab", 7)).toBe("abababa");
    expect(displayWidth(fill("ab", 7))).toBe(7);
    expect(displayWidth(fill("x", 4))).toBe(4);
    expect(fill("", 3)).toBe("   ");
  });

  test("truncates when the pattern is too long", () => {
    expect(displayWidth(fill("toolong", 3))).toBe(3);
    expect(fill("toolong", 3)).toBe("too");
  });
});
