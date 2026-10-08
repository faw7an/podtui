/**
 * Classify one log line as error / warn / info / debug / unknown (FR-5).
 *
 * Pure and line-local: no state carries between lines, so a stack trace's
 * `at ...` continuation lines stay `unknown` (the header line is what turns
 * red). ANSI escapes are ignored for matching only; callers keep the raw line.
 *
 * Rules, first that applies wins:
 *
 * 1. **Structured field.** JSON `"level"|"lvl"|"severity"|"loglevel": "<word>"`
 *    or logfmt `level=<word>` (also `lvl=`, `severity=`, `loglevel=`, value
 *    optionally quoted). The word is mapped through LEVEL_WORDS, any case.
 *    An unrecognised word falls through to the next rules.
 *    Numeric levels (e.g. pino's 50) are not interpreted: they are
 *    library-specific and not verified here.
 * 2. **Level token**, earliest in the line wins, so `INFO retry after ERROR`
 *    is info. A token is a LEVEL_WORDS word that is either
 *    - all upper case and a whole word: `ERROR`, `WARN`, `FATAL`;
 *    - wrapped in brackets, any case: `[error]` (nginx), `<warn>`, `(Debug)`;
 *    - followed by a colon, any case: `error:`, `Warning:`, `panic:`.
 *    "Whole word" means no letter, digit or `_` on either side, so `terror`,
 *    `ERRORS`, `ERROR_CODE`, `information` and `debugger` never match.
 *    Lower-case words in prose (`no error found`) deliberately do not match.
 * 3. **Exception markers** → error: a class name ending in `Exception` or
 *    `Error` with at least one character before the suffix (`ValueError`,
 *    `java.lang.NullPointerException`), or `Traceback (most recent call last)`.
 *
 * Tests: `test/logLevel.test.ts` (table-driven, incl. false positives).
 */

export type LogLevel = "error" | "warn" | "info" | "debug" | "unknown";

/** Words that name a level, lower-case. Exported so the help/README can list them. */
export const LEVEL_WORDS: Readonly<Record<string, Exclude<LogLevel, "unknown">>> = {
  emerg: "error",
  emergency: "error",
  alert: "error",
  crit: "error",
  critical: "error",
  fatal: "error",
  panic: "error",
  severe: "error",
  error: "error",
  err: "error",
  warn: "warn",
  warning: "warn",
  notice: "info",
  info: "info",
  debug: "debug",
  trace: "debug",
};

const WORDS = Object.keys(LEVEL_WORDS).join("|");

// eslint-disable-next-line no-control-regex -- ANSI escapes start with ESC
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

const JSON_FIELD = /"(?:level|lvl|severity|loglevel)"\s*:\s*"([A-Za-z]+)"/i;
const LOGFMT_FIELD = /(?<![\w.])(?:level|lvl|severity|loglevel)=("?)([A-Za-z]+)\1(?![\w])/i;

const UPPER_TOKEN = new RegExp(`(?<![A-Za-z0-9_])(${WORDS.toUpperCase()})(?![A-Za-z0-9_])`, "g");
const BRACKET_TOKEN = new RegExp(`[[(<](${WORDS})[\\])>]`, "gi");
const COLON_TOKEN = new RegExp(`(?<![A-Za-z0-9_])(${WORDS}):`, "gi");

// At least one identifier character before the suffix, so `Error` alone
// (`Error handling enabled`) is prose, not a class name.
const EXCEPTION = /(?<![\w$])[\w$.]*[\w$](?:Exception|Error)(?![A-Za-z0-9_])/;
const TRACEBACK = /Traceback \(most recent call last\)/;

export function stripAnsi(line: string): string {
  return line.replace(ANSI, "");
}

function wordLevel(word: string): Exclude<LogLevel, "unknown"> | undefined {
  return LEVEL_WORDS[word.toLowerCase()];
}

function structuredLevel(line: string): LogLevel | undefined {
  const json = JSON_FIELD.exec(line);
  if (json?.[1]) {
    const level = wordLevel(json[1]);
    if (level) return level;
  }
  const logfmt = LOGFMT_FIELD.exec(line);
  if (logfmt?.[2]) return wordLevel(logfmt[2]);
  return undefined;
}

function earliestToken(line: string): LogLevel | undefined {
  let best: { index: number; level: Exclude<LogLevel, "unknown"> } | undefined;
  for (const re of [UPPER_TOKEN, BRACKET_TOKEN, COLON_TOKEN]) {
    re.lastIndex = 0;
    const m = re.exec(line);
    if (!m?.[1]) continue;
    const level = wordLevel(m[1]);
    if (level && (best === undefined || m.index < best.index)) best = { index: m.index, level };
  }
  return best?.level;
}

function isException(line: string): boolean {
  return TRACEBACK.test(line) || EXCEPTION.test(line);
}

export function classifyLogLine(raw: string): LogLevel {
  const line = stripAnsi(raw);
  return structuredLevel(line) ?? earliestToken(line) ?? (isException(line) ? "error" : "unknown");
}
