/**
 * Env tab (P3-T6): sorted entries, secret masking until `v`, values coloured.
 * Fixture: test/fixtures/container-inspect.json (`web`, seeded API_TOKEN).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MASK, buildDetail, isSecretKey, maskValue, parseEnv } from "../src/ui/view/detail.ts";
import { renderDetail } from "../src/ui/render/detailLines.ts";
import { dim, fg, RESET, stripAnsi } from "../src/ui/render/palette.ts";
import { displayWidth } from "../src/util/fit.ts";
import { defaultTheme } from "../src/theme/theme.ts";
import type { ContainerInspect } from "../src/api/types.ts";

const inspect = JSON.parse(readFileSync("test/fixtures/container-inspect.json", "utf8")) as ContainerInspect;

describe("masker", () => {
  test.each([
    ["API_TOKEN", true],
    ["GITHUB_TOKEN", true],
    ["DB_PASSWORD", true],
    ["MYSQL_ROOT_PASSWD", true],
    ["AWS_SECRET_ACCESS_KEY", true],
    ["private_key", true],
    ["Gcp_Credentials", true],
    // Over-masking is deliberate: substring match, one keypress to reveal.
    ["KEYBOARD_LAYOUT", true],
    ["PATH", false],
    ["HOME", false],
    ["NODE_ENV", false],
    ["HOSTNAME", false],
    ["PORT", false],
  ])("%p secret=%p", (key, secret) => {
    expect(isSecretKey(key)).toBe(secret);
  });

  test("the mask has a fixed length, so it does not tell the secret's length", () => {
    expect(maskValue("API_TOKEN", "x")).toBe(MASK);
    expect(maskValue("API_TOKEN", "x".repeat(200))).toBe(MASK);
    expect(maskValue("PATH", "/bin")).toBe("/bin");
    // Nothing to hide in an empty value; masking it would claim a secret.
    expect(maskValue("API_TOKEN", "")).toBe("");
  });
});

describe("parseEnv", () => {
  test("sorted by key; a bare KEY has an empty value; '=' inside values kept", () => {
    expect(parseEnv(["Z=1", "A=x=y", "M"])).toEqual([
      { key: "A", value: "x=y", secret: false },
      { key: "M", value: "", secret: false },
      { key: "Z", value: "1", secret: false },
    ]);
  });
});

describe("Env tab", () => {
  test("fixture: sorted, API_TOKEN masked, the token appears nowhere", () => {
    const d = buildDetail({ inspect, activeTab: "env", hasSelection: true });
    const keys = d.lines.map((l) => l.split(/\s+/)[0]);
    expect(keys).toEqual([...keys].sort());
    const text = d.lines.join("\n");
    expect(text).toMatch(new RegExp(`API_TOKEN\\s+\\${MASK.split("").join("\\")}`));
    expect(text).not.toContain("super-secret-token-12345");
    expect(d.hint).toBe("1 masked · v reveal");
  });

  test("revealed: the value is shown and the hint says how to hide it", () => {
    const d = buildDetail({ inspect, activeTab: "env", hasSelection: true, revealSecrets: true });
    expect(d.lines.join("\n")).toContain("super-secret-token-12345");
    expect(d.hint).toBe("secrets shown · v hide");
  });

  test("names plain, values in the accent colour, a mask dim; widths exact", () => {
    const d = buildDetail({ inspect, activeTab: "env", hasSelection: true });
    const out = renderDetail({ x: 0, y: 0, w: 70, h: 20 }, { ...d, tabs: d.tabs }, { theme: defaultTheme, color: true });
    for (const line of out) expect(displayWidth(line)).toBe(70);
    const tokenRow = out.find((l) => l.includes("API_TOKEN")) ?? "";
    // Key padded to the widest key, unpainted; then the dim mask.
    expect(tokenRow).toMatch(new RegExp(`API_TOKEN +${dim().replace("[", "\\[")}\\*{8}`));
    const portRow = out.find((l) => l.includes("PORT ")) ?? "";
    expect(portRow).toContain(`${fg(defaultTheme.accent)}8080${RESET}`);
    // The hint is on the bottom border.
    expect(stripAnsi(out.at(-1) ?? "")).toContain("1 masked · v reveal");
  });

  test("no environment at all says so", () => {
    const d = buildDetail({ inspect: { ...inspect, Config: { ...inspect.Config, Env: [] } }, activeTab: "env", hasSelection: true });
    expect(d.lines).toEqual(["No environment variables."]);
    expect(d.hint).toBeUndefined();
  });
});
